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

# A dragged-in folder is empty once its files have moved into their exports, so
# the husk goes. -depth collapses nested ones from the inside out. Only ever
# EMPTY directories, and never ours, so nothing of the user's is ever removed
# with anything still in it.
#
# A function because the phases below can finish early, and a run that exits
# before this would leave a husk sitting in the folder until the next drop.
clear_husks() {
  find "$FOLDER" -mindepth 1 -depth -type d -empty ! -name '.*' ! -name files \
    -exec rmdir {} ';' 2>/dev/null || true
}

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
export_drop() { # $1 file, $2 digest, $3 counter, $4 epoch, $5 --batch -> 0 on success
  # The destination is always the watched folder, never the file's own
  # directory, so a photo that came out of a dragged-in folder lands beside
  # every other recording instead of building an export inside that folder.
  #
  # $5 is passed through so a run can say "this is one file of a drop": no
  # per-file wait for the sealing anchor and no per-file rebuild of the sheet,
  # because the caller does both once at the end.
  result=$("$OSASCRIPT" -l JavaScript "$EXPORTER" "$1" "$2" "$3" "$4" "$FOLDER" "${5:-}" 2>&1)
  case "$result" in
    ok*) return 0 ;;
    *) log "export: $result"; return 1 ;;
  esac
}

# Mark a digest handled, but ONLY once its export exists.
#
# ⚠️ THE ORDER MATTERS AND USED TO BE WRONG. This was written before the export
# ran, so a failed export left the digest marked handled forever: every later
# drop of that file hit the state check, logged "already recorded, left in
# place", and never tried again. One file on this machine was stuck that way
# from the day it was first dropped. Recording it a second time is not the risk
# here, because the ledger dedupes by digest; losing the ability to retry is.
handled() { echo "$1" >> "$STATE"; }

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

# Finish any export still waiting on the anchor that seals it. No wait here:
# this is housekeeping left by an earlier run, not the drop being handled now,
# and the run at the END of this script is the one that waits.
"$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" 0 >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# A drop is handled in PHASES, not one file at a time.
#
# Hashing was never the cost. Measured on this machine: a hundred files hash in
# 0.52 seconds. Everything else was waiting, and all of it was being paid PER
# FILE:
#
#   ~1s    settling, because a just-dropped file is by definition fresh
#   ~1.3s  one ledger lookup round trip (a lookup carrying 25 digests: 0.72s)
#   ~1     commit round trip
#   ~12s   waiting for the anchor that seals THIS proof
#   O(n)   rebuilding every page and thumbnail in the folder, per file
#
# So a hundred files cost a hundred settles, a hundred lookups, a hundred
# commits, a hundred anchor waits and a hundred full index passes. Every one of
# those five collapses to once per drop, because the settle is a property of the
# batch, both endpoints already take arrays, one anchor seals every proof
# committed before it, and the sheet only has to be right when the run ends.
#
# What does NOT change: the order in which a file becomes safe. Bytes are still
# settled before they are hashed, a digest is still marked handled only after
# its export exists, and a file is never moved until its proof is written.
# ---------------------------------------------------------------------------

TAB=$(printf '\t')

# macOS ships bash 3.2, which has no associative arrays, so the ledger's answers
# go to a file and are matched with grep -F. Indexed arrays are fine and hold
# any filename the filesystem allows.
keep_paths=(); keep_digests=(); keep_before=()

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

  # Hash first, settle only what needs it. A file still copying cannot collide
  # with a digest already in the state file, so a state hit is proof of
  # completeness and costs no wait; that keeps rescans of a big folder (or a
  # bulk re-copy of known files) at hashing speed.
  before=$(stat -f '%z %m' "$f" 2>/dev/null) || continue
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

  keep_paths+=("$f")
  keep_digests+=("$digest")
  keep_before+=("$before")
# Process substitution, not a pipe: a piped `while` runs in a subshell, so every
# variable it set would be discarded at the end of the loop.
done < <(droppable)

count=${#keep_paths[@]}
[ "$count" -eq 0 ] && { clear_husks; exit 0; }

resp_file="$HOME_DIR/.response.json"

# ---- ask the ledger about everything at once -------------------------------
#
# Already on record? Then a drop is a lookup, not a recording. Both endpoints
# have always taken arrays; only this script insisted on asking one at a time.
FOUND="$HOME_DIR/.found"
: > "$FOUND"
i=0
while [ "$i" -lt "$count" ]; do
  chunk=""; j=0
  while [ "$j" -lt 25 ] && [ $((i + j)) -lt "$count" ]; do
    chunk="$chunk${chunk:+,}\"$(to_urlsafe "${keep_digests[$((i + j))]}")\""
    j=$((j + 1))
  done
  if curl -s --max-time 60 -X POST "$API/api/proofs/batch" \
       -H "Content-Type: application/json" \
       -d "{\"digests\":[$chunk]}" -o "$resp_file"; then
    out=$(parse_json batchmany "$resp_file")
    # A failed lookup is not an absent recording. Left out of FOUND, these fall
    # through to the commit below, and the ledger dedupes by digest anyway, so
    # the worst case is a wasted request rather than a duplicate proof.
    [ "$out" = "error" ] || printf '%s\n' "$out" >> "$FOUND"
  else
    log "ledger lookup failed for a chunk (will fall through to commit)"
  fi
  i=$((i + 25))
done

# ---- settle: is anything still being written? ------------------------------
#
# ⚠️ THIS RUNS AFTER THE LOOKUP ON PURPOSE, AND THAT IS THE WHOLE TRICK. A file
# still being copied must never be recorded, which needs an observation window,
# and a window is just time. The old code bought that time with `sleep 1` on
# every fresh drop, which is a second the person is standing there for.
#
# The ledger lookup above is a network round trip we are making anyway, so the
# window is free: snapshot size and mtime before hashing, ask the ledger, then
# re-stat and REHASH. Anything whose bytes moved across all of that was being
# written and is left for the next pass. Nothing has been committed yet, so a
# dropped file costs one wasted lookup and nothing else.
#
# ⚠️ DO NOT shorten this window back to "across the hash" alone. That was tried
# and it FAILED: hashing a small file takes milliseconds, shorter than the gap
# between two writes, and `stat` mtime has one-second granularity so it does not
# move either. A file being appended to every 120ms sailed through and was
# recorded half-written.
settled_paths=(); settled_digests=()
for i in $(seq 0 $((count - 1))); do
  f="${keep_paths[$i]}"
  now=$(stat -f '%z %m' "$f" 2>/dev/null) || continue
  d=$(openssl dgst -sha256 -binary "$f" 2>/dev/null | base64) || continue
  if [ "$now" != "${keep_before[$i]}" ] || [ "$d" != "${keep_digests[$i]}" ]; then
    log "skipped (still copying): $(basename "$f")"
    continue
  fi
  settled_paths+=("$f")
  settled_digests+=("$d")
done
keep_paths=("${settled_paths[@]:+${settled_paths[@]}}")
keep_digests=("${settled_digests[@]:+${settled_digests[@]}}")
count=${#keep_paths[@]}
[ "$count" -eq 0 ] && { clear_husks; exit 0; }

# Everything the ledger already held, before anything new is committed. Kept
# because the two outcomes have to stay distinguishable: a drop of known bytes
# is a LOOKUP and says "on record", a drop of new bytes is a recording and says
# "recorded #N". Once commit results are appended to FOUND the two are
# indistinguishable, so the line is drawn here.
PRIOR="$HOME_DIR/.prior"
cp "$FOUND" "$PRIOR" 2>/dev/null || : > "$PRIOR"

# ---- commit whatever is not on record, also at once ------------------------
new_digests=()
for i in $(seq 0 $((count - 1))); do
  grep -qF "${keep_digests[$i]}$TAB" "$FOUND" && continue
  new_digests+=("${keep_digests[$i]}")
done

new_count=${#new_digests[@]}
i=0
while [ "$i" -lt "$new_count" ]; do
  chunk=""; j=0
  while [ "$j" -lt 20 ] && [ $((i + j)) -lt "$new_count" ]; do
    chunk="$chunk${chunk:+,}{\"digestB64\":\"${new_digests[$((i + j))]}\",\"hashAlg\":\"sha256\"}"
    j=$((j + 1))
  done
  outcome=""
  # Retries cover the daily epoch rotation window, where the service holds a
  # drop rather than failing it.
  for _ in 1 2 3; do
    # -D captures the response headers. One of them states the current released
    # version of this tool, which is how an installed copy learns it is behind
    # without ever asking: no timer, no extra request, no host we were not
    # already talking to, and nothing about this machine sent upward. It rides
    # on the commit the user asked for by dropping a file.
    curl -s --max-time 180 -X POST "$API/api/commit" \
      -H "Content-Type: application/json" \
      -D "$HOME_DIR/.headers" \
      -d "{\"digests\":[$chunk],\"chainId\":\"bitgraph:main\"}" -o "$resp_file"
    outcome=$(parse_json commitmany "$resp_file")
    case "$outcome" in retry) sleep 20 ;; *) break ;; esac
  done
  case "$outcome" in
    retry)
      log "camera restarting, $((new_count - i)) not recorded yet (retry on next drop)"
      notify "Camera restarting" "Not recorded yet; drops retry on the next folder change"
      ;;
    fail|"")
      log "record FAILED for a chunk of $j"
      notify "Not recorded" "See $HOME_DIR/hotfolder.err"
      ;;
    *)
      printf '%s\n' "$outcome" >> "$FOUND"
      if [ -f "$HOME_DIR/.headers" ]; then
        # Header names are case-insensitive and curl passes them through as the
        # server sent them, so match case-insensitively; strip the CR that ends
        # every HTTP header line, or the comparison downstream never matches.
        grep -i '^X-BitGraph-Folder-Version:' "$HOME_DIR/.headers" 2>/dev/null \
          | tail -1 | cut -d: -f2- | tr -d ' \r\n' > "$HOME_DIR/latest" || true
      fi
      ;;
  esac
  i=$((i + 20))
done

# ---- say so NOW ------------------------------------------------------------
#
# ⚠️ THE NOTIFICATION GOES BEFORE THE EXPORTS, AND BEFORE THE SEAL. A recording
# exists the moment the commit returns, which is about three seconds after the
# drop. Everything after this point is packaging: writing the export, fetching
# the anchors, waiting for the one that seals it. Announcing at the end of all
# that made a single drop feel like sixteen seconds instead of three, which is
# a regression I introduced when the phases went in, and it is the number the
# person standing at the folder actually experiences.
#
# The export can still fail after this. That is the same trade the per-file
# version made, and it is the honest one: the proof is on the ledger and stands
# on its own, so the notification is not lying if the packaging trips.
recorded=0
on_record=0
last_name=""
last_counter=""
for i in $(seq 0 $((count - 1))); do
  hit=$(grep -F "${keep_digests[$i]}$TAB" "$FOUND" | head -1)
  [ -z "$hit" ] && continue
  if grep -qF "${keep_digests[$i]}$TAB" "$PRIOR"; then
    on_record=$((on_record + 1))
  else
    recorded=$((recorded + 1))
    last_name=$(basename "${keep_paths[$i]}")
    last_counter=$(printf '%s' "$hit" | cut -f2)
  fi
done

# One notification per DROP, not per file. A hundred files used to mean a
# hundred notifications, which is both unusable and slow: each one is its own
# osascript process, and they queue in Notification Centre for minutes.
if [ "$recorded" -eq 1 ] && [ "$on_record" -eq 0 ]; then
  notify "Recorded #$last_counter" "$last_name"
elif [ "$recorded" -gt 1 ] && [ "$on_record" -eq 0 ]; then
  notify "Recorded $recorded files" "Newest #$last_counter · $last_name"
elif [ "$recorded" -eq 0 ] && [ "$on_record" -gt 0 ]; then
  notify "Already on record" "$on_record $([ "$on_record" -eq 1 ] && echo file || echo files)"
elif [ $((recorded + on_record)) -gt 0 ]; then
  notify "Recorded $recorded files" "$on_record already on record"
fi

# ---- build the exports -----------------------------------------------------
#
# Sequential on purpose: exports share files/ and .thumbs/, and `ln` without -f
# plus a numbered fallback is not safe to run concurrently against itself.
# --batch tells the exporter that this run seals and indexes once at the end.
for i in $(seq 0 $((count - 1))); do
  f="${keep_paths[$i]}"
  d="${keep_digests[$i]}"
  name=$(basename "$f")
  hit=$(grep -F "$d$TAB" "$FOUND" | head -1)
  if [ -z "$hit" ]; then
    log "not recorded (will retry on next drop): $name"
    continue
  fi
  counter=$(printf '%s' "$hit" | cut -f2)
  epoch=$(printf '%s' "$hit" | cut -f3)
  # Marked handled only once the export exists; see handled().
  if export_drop "$f" "$d" "$counter" "$epoch" --batch; then
    handled "$d"
    if grep -qF "$d$TAB" "$PRIOR"; then
      # These bytes were already on the ledger, so this drop was a lookup and
      # nothing new was minted. Same wording the site uses for the same case.
      log "on record  · $name · #$counter"
    else
      log "recorded #$counter · $name · $API/proof/$(to_urlsafe "$d")?counter=$counter&epoch=$epoch"
    fi
  fi
done

# ---- seal and index, once --------------------------------------------------
#
# One wait covers the whole drop: anchors are time-based, so the anchor that
# lands after the last commit seals every proof in it. This also writes the
# contact sheet, so there is no separate index pass.
if [ $((recorded + on_record)) -gt 0 ]; then
  # Only a fresh recording can still be waiting on an anchor. A drop of bytes
  # already on the ledger was sealed long ago, so it needs the index pass but
  # never the wait.
  wait_ms=0
  [ "$recorded" -gt 0 ] && wait_ms=45000
  "$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" "$wait_ms" >/dev/null 2>&1 || true
fi

clear_husks
