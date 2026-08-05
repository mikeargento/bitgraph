#!/bin/bash
# BitGraph Folder: record every file dropped into the watched folder.
#
# Triggered by launchd (WatchPaths) whenever the folder changes. Takes every
# file dropped in, INCLUDING the contents of a folder someone dragged in, which
# a browser cannot offer and this can. Skips hidden files and its own
# directories, waits for a file's size to go stable before hashing (so
# half-copied files are never hashed), then checks the digest against the ledger
# and records only if the bytes are not already on it.
#
# Only the SHA-256 digest leaves the machine. File contents never do.
#
# Each handled file is then wrapped by export.js into a `BitGraph (name)/` folder
# holding proof.json, an ethereum-anchors/ subfolder with the bracketing anchors
# and their block header witnesses, and the file itself. This is the same layout
# the website's proof-page export produces. The dropped file is MOVED in, so the
# folder holds one export per drop and nothing loose, and a dragged-in folder is
# left empty and removed.
#
# Receipts: a macOS notification per outcome, and the export folder itself.
# Diagnostics go to stderr, which launchd writes to the error log configured in
# the plist, deliberately outside the visible folder. State (already-handled
# digests) lives beside this script so a re-fired watch never re-records the
# same bytes.
#
# macOS only: this uses launchd, BSD stat, and osascript.

set -u

CONFIG="${BITGRAPH_CONFIG:-$HOME/.bitgraph/config}"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"

FOLDER="${BITGRAPH_FOLDER:-$HOME/BitGraph}"
API="${BITGRAPH_API:-https://bitgraph.ing}"
HOME_DIR="${BITGRAPH_HOME:-$HOME/.bitgraph}"
STATE="$HOME_DIR/hotfolder.state"
LOCK="$HOME_DIR/hotfolder.lock"
EXPORTER="$HOME_DIR/export.js"

# The exporter runs under JavaScript for Automation, which ships with macOS.
# Absolute path because launchd hands this script a minimal PATH.
OSASCRIPT="/usr/bin/osascript"

mkdir -p "$HOME_DIR"

# One run at a time; launchd queues another run if events arrive meanwhile.
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$HOME_DIR/.response.json" "$HOME_DIR/.headers"' EXIT

# The exporter compares this against what the site advertises, to say on the
# contact sheet when a newer release exists. Exported rather than merely sourced
# because osascript is a child process and would not otherwise see it.
export BITGRAPH_VERSION="${BITGRAPH_VERSION:-unknown}"

touch "$STATE"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >&2; }

notify() { # $1 title-suffix, $2 body
  /usr/bin/osascript -e "display notification \"$2\" with title \"BitGraph\" subtitle \"$1\"" 2>/dev/null
}

to_urlsafe() { printf '%s' "$1" | tr '+/' '-_' | tr -d '='; }

if [ ! -f "$EXPORTER" ]; then
  log "exporter missing at $EXPORTER. Nothing was recorded."
  notify "Setup needed" "Reinstall BitGraph Folder"
  exit 1
fi

# Responses are handed over as FILES, not pipes. The exporter reads them
# directly, which has no size ceiling; a response carrying a multi-kilobyte
# attestation would be at the mercy of shell pipe limits otherwise.
parse_json() { # $1 batch|commit, $2 response file
  "$OSASCRIPT" -l JavaScript "$EXPORTER" --json "$1" "$2" 2>/dev/null
}

# Wrap one handled file into its export folder. The exporter moves the file in,
# so nothing else here may touch it afterwards. Never fatal: the recording
# already stands on its own, the export is only the packaging.
export_drop() { # $1 file, $2 digest, $3 counter, $4 epoch
  # The destination is always the watched folder, never the file's own
  # directory, so a photo that came out of a dragged-in folder lands beside
  # every other recording instead of building an export inside that folder.
  result=$("$OSASCRIPT" -l JavaScript "$EXPORTER" "$1" "$2" "$3" "$4" "$FOLDER" 2>&1)
  case "$result" in
    ok*) ;;
    *) log "export: $result" ;;
  esac
}

# Everything droppable, including the contents of a folder someone dragged in.
#
# Dragging a folder of photos used to do NOTHING: the loop tested `-f` and moved
# on, with no log line and no notification, which is indistinguishable from a
# dead watcher. It is also the obvious thing to try, and the one thing a browser
# cannot offer, so the folder should be better at it than the website rather
# than worse.
#
# Ours are pruned rather than descended into: files/ holds hard links to things
# already recorded, .thumbs/ is generated, and any directory carrying a
# proof.json is an export. Recursive, because a folder of folders of photos is
# still a folder of photos.
droppable() {
  find "$FOLDER" -mindepth 1 \
    \( -name '.*' \
       -o -name files \
       -o \( -type d -exec test -e '{}/proof.json' ';' \) \
    \) -prune -o -type f -print0
}

# Finish any export still waiting on the anchor that seals it.
"$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" >/dev/null 2>&1 || true

while IFS= read -r -d '' f; do
  name=$(basename "$f")
  # index.html is written BY the exporter into this very folder, so recording
  # it would be a feedback loop: writing it trips the watch, the watch records
  # it, recording rewrites it. It cannot self-limit through the digest state
  # either, because each rewrite changes the row count and so produces new
  # bytes and a new digest every pass. This minted six permanent proofs on
  # 2026-08-04 before the watch was stopped. The exporter's own output must
  # never be one of its inputs.
  case "$name" in .*|index.html) continue ;; esac

  # Hash first, stability-wait only for unknown bytes. A file still copying
  # cannot collide with a digest already in the state file, so a state hit is
  # proof of completeness and costs no wait; that keeps rescans of a big folder
  # (or a bulk re-copy of known files) at hashing speed instead of ~1s per file.
  # Unknown bytes get the settle-then-REHASH treatment so a half-copied new file
  # is never recorded.
  digest=$(openssl dgst -sha256 -binary "$f" | base64)
  # Say so rather than vanishing. Until 2026-08-04 this skipped before writing
  # any log line, so re-dropping something recorded weeks ago produced no
  # export, no message and no clue, which is indistinguishable from a broken
  # watcher. The state file survives uninstall by design and holds every digest
  # the machine has ever recorded, so this is the ordinary case, not a rare one.
  if grep -qxF "$digest" "$STATE"; then
    log "already recorded, left in place: $name"
    continue
  fi

  mtime=$(stat -f%m "$f" 2>/dev/null) || continue
  if [ $(( $(date +%s) - mtime )) -lt 5 ]; then
    stable=0
    prev=-1
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      size=$(stat -f%z "$f" 2>/dev/null) || break
      if [ "$size" = "$prev" ]; then stable=1; break; fi
      prev=$size
      sleep 1
    done
    [ "$stable" = 1 ] || { log "skipped (still copying): $name"; continue; }
    digest=$(openssl dgst -sha256 -binary "$f" | base64)
    if grep -qxF "$digest" "$STATE"; then continue; fi
  fi
  urlsafe=$(to_urlsafe "$digest")

  # Already on record? Then this drop is a lookup, not a recording. The parser
  # returns the earliest causal position so the export is built from the
  # originating proof rather than minting a new one.
  resp_file="$HOME_DIR/.response.json"
  curl -s --max-time 25 -X POST "$API/api/proofs/batch" \
    -H "Content-Type: application/json" \
    -d "{\"digests\":[\"$urlsafe\"]}" -o "$resp_file"
  on_record=$(parse_json batch "$resp_file")

  case "$on_record" in
    yes*)
      counter=$(printf '%s' "$on_record" | cut -f2)
      epoch=$(printf '%s' "$on_record" | cut -f3)
      echo "$digest" >> "$STATE"
      log "on record  · $name · #$counter"
      notify "Already on record" "$name"
      export_drop "$f" "$digest" "$counter" "$epoch"
      continue
      ;;
    error)
      log "check failed (will retry on next drop): $name"
      continue
      ;;
  esac

  # Record. Retries cover the daily epoch rotation window, where the service
  # holds a drop rather than failing it.
  outcome=""
  for _ in 1 2 3; do
    # -D captures the response headers. One of them states the current released
    # version of this tool, which is how an installed copy learns it is behind
    # without ever asking: no timer, no extra request, no host we were not
    # already talking to, and nothing about this machine sent upward. It rides
    # on the commit the user asked for by dropping a file.
    curl -s --max-time 120 -X POST "$API/api/commit" \
      -H "Content-Type: application/json" \
      -D "$HOME_DIR/.headers" \
      -d "{\"digests\":[{\"digestB64\":\"$digest\",\"hashAlg\":\"sha256\"}],\"chainId\":\"bitgraph:main\"}" -o "$resp_file"
    outcome=$(parse_json commit "$resp_file")
    case "$outcome" in ok*) break ;; retry) sleep 20 ;; *) break ;; esac
  done

  case "$outcome" in
    ok*)
      counter=$(printf '%s' "$outcome" | cut -f2)
      epoch=$(printf '%s' "$outcome" | cut -f3)
      # Stash the advertised version for the contact sheet to read. Header names
      # are case-insensitive and curl passes them through as the server sent
      # them, so match case-insensitively; strip the CR that ends every HTTP
      # header line, or the comparison downstream never matches.
      if [ -f "$HOME_DIR/.headers" ]; then
        grep -i '^X-BitGraph-Folder-Version:' "$HOME_DIR/.headers" 2>/dev/null \
          | tail -1 | cut -d: -f2- | tr -d ' \r\n' > "$HOME_DIR/latest" || true
      fi
      echo "$digest" >> "$STATE"
      log "recorded #$counter · $name · $API/proof/$urlsafe?counter=$counter&epoch=$epoch"
      notify "Recorded #$counter" "$name"
      export_drop "$f" "$digest" "$counter" "$epoch"
      ;;
    retry)
      log "camera restarting, not recorded yet (will retry on next drop): $name"
      notify "Camera restarting" "$name not recorded yet; drops retry on the next folder change"
      ;;
    *)
      log "record FAILED: $name"
      notify "Not recorded" "$name failed; see $HOME_DIR/hotfolder.err"
      ;;
  esac
# Process substitution, not a pipe: a piped `while` runs in a subshell, so every
# variable it set would be discarded at the end of the loop.
done < <(droppable)

# A dragged-in folder is empty once its files have moved into their exports, so
# the husk goes. -depth collapses nested ones from the inside out. Only ever
# EMPTY directories, and never ours, so nothing of the user's is ever removed
# with anything still in it.
find "$FOLDER" -mindepth 1 -depth -type d -empty ! -name '.*' ! -name files \
  -exec rmdir {} ';' 2>/dev/null || true
