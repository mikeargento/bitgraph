#!/bin/bash
# BitGraph Folder: record every file dropped into the watched folder.
#
# Triggered by launchd (WatchPaths) whenever the folder changes. Scans the top
# level only, skips hidden files and directories, waits for a file's size to go
# stable before hashing (so half-copied files are never hashed), then checks the
# digest against the ledger and records only if the bytes are not already on it.
#
# Only the SHA-256 digest leaves the machine. File contents never do.
#
# Each handled file is then wrapped by export.js into a bitgraph-proof-<N>/
# folder holding proof.json, an ethereum-anchors/ subfolder with the bracketing
# anchors and their block header witnesses, and the file itself. This is the
# same layout the website's proof-page export produces. The dropped file is
# MOVED in, so the folder holds one export per drop and nothing loose.
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
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$HOME_DIR/.response.json"' EXIT

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
  result=$("$OSASCRIPT" -l JavaScript "$EXPORTER" "$1" "$2" "$3" "$4" 2>&1)
  case "$result" in
    ok*) ;;
    *) log "export: $result" ;;
  esac
}

# Finish any export still waiting on the anchor that seals it.
"$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" >/dev/null 2>&1 || true

for f in "$FOLDER"/*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  case "$name" in .*) continue ;; esac

  # Hash first, stability-wait only for unknown bytes. A file still copying
  # cannot collide with a digest already in the state file, so a state hit is
  # proof of completeness and costs no wait; that keeps rescans of a big folder
  # (or a bulk re-copy of known files) at hashing speed instead of ~1s per file.
  # Unknown bytes get the settle-then-REHASH treatment so a half-copied new file
  # is never recorded.
  digest=$(openssl dgst -sha256 -binary "$f" | base64)
  if grep -qxF "$digest" "$STATE"; then continue; fi

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
    curl -s --max-time 120 -X POST "$API/api/commit" \
      -H "Content-Type: application/json" \
      -d "{\"digests\":[{\"digestB64\":\"$digest\",\"hashAlg\":\"sha256\"}],\"chainId\":\"bitgraph:main\"}" -o "$resp_file"
    outcome=$(parse_json commit "$resp_file")
    case "$outcome" in ok*) break ;; retry) sleep 20 ;; *) break ;; esac
  done

  case "$outcome" in
    ok*)
      counter=$(printf '%s' "$outcome" | cut -f2)
      epoch=$(printf '%s' "$outcome" | cut -f3)
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
done
