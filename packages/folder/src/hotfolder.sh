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
# left empty and removed. (A person who wants their original kept where it was
# copies it in — a plain same-disk drag into any folder is a MOVE by Finder's
# rule, not ours; settled 2026-08-05.)
#
# Receipts: a macOS notification per outcome, and the export folder itself.
# Diagnostics go to stderr, which launchd writes to the error log configured in
# the plist, deliberately outside the visible folder. Re-recording is never a
# risk: the ledger dedupes by digest, and a drop of bytes already on record is
# answered ("Already on record") rather than silently skipped.
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

# The sealing wait has its own lock, separate from the drop lock, so waiting on
# an anchor never blocks the next drop from being handled. Skipping when another
# run is already sealing is correct, not a compromise: the sealer sweeps every
# pending export in the folder and re-checks before it quits, so whoever holds
# this lock finishes ours too.
SEAL_LOCK="$HOME_DIR/hotfolder.seal.lock"

# A lock is a directory holding its owner's PID.
#
# mkdir is the atomic take, same as ever. The PID is what makes a crash
# survivable: a SIGKILL (reboot, launchd tearing a job down) runs no trap, and
# a lock that nothing will ever release used to mean every future invocation
# bounced off it and the watcher was dead until someone cleaned up by hand.
# With RunAtLoad, even login could not have healed it.
#
# A lock with no PID file yet is treated as live while it is fresh, because the
# owner writes the PID immediately after mkdir and a checker can land in
# between; one that has sat PID-less for over a minute is a corpse (a crash in
# that same gap, or a lock left by a version before PIDs) and is cleared.
lock_is_live() { # $1 lockdir
  [ -d "$1" ] || return 1
  pid=$(cat "$1/pid" 2>/dev/null)
  if [ -n "$pid" ]; then
    kill -0 "$pid" 2>/dev/null
    return
  fi
  now=$(date +%s)
  born=$(stat -f %m "$1" 2>/dev/null || echo 0)
  [ $(( now - born )) -lt 60 ]
}

lock_is_live "$LOCK" || rm -rf "$LOCK"
lock_is_live "$SEAL_LOCK" || rm -rf "$SEAL_LOCK"

# One run at a time.
#
# ⚠️ A REFUSED INVOCATION LEAVES A NOTE. It used to just exit, and launchd does
# NOT queue anything: WatchPaths fires on a folder change, and that change has
# already been and gone. So a file dropped while a run was busy got no run of
# its own and sat there until some later, unrelated change happened to trigger
# one. That is both the lag on back-to-back drops and a way to be missed
# entirely.
#
# The holder checks for this note when it finishes and starts over.
if ! mkdir "$LOCK" 2>/dev/null; then
  : > "$HOME_DIR/.rescan"
  exit 0
fi
echo $$ > "$LOCK/pid"

# ⚠️ The trap does NOT touch SEAL_LOCK. It did, and that one line was the whole
# 11-second lag: the trap freed the seal lock as the main script exited, launchd
# then killed the process group, the "detached" sealer died with it, and the
# NEXT drop's opening sweep did the sealing synchronously, in front of the
# person, before their own file was even looked at. The sealer owns its lock
# and removes it itself; a sealer that dies without doing so is cleared by the
# liveness check above.
trap 'rm -rf "$LOCK" "$HOME_DIR/.response.json" "$HOME_DIR/.headers" "$HOME_DIR/.responses" "$HOME_DIR/.found" "$HOME_DIR/.prior" "$HOME_DIR/.drop"' EXIT

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
# An export sitting flat at the top level (an older layout, or one dragged
# back in from anywhere) belongs in Recordings/. The index pass is what tucks
# it there, and a drag-in of an already-built export is exactly the case where
# the run otherwise finds nothing to record and exits before any index pass:
# the export would sit at the top level until some later drop. One cheap glob
# decides; the pass itself is ~0.1s when there is nothing else to do.
tuck_strays() {
  compgen -G "$FOLDER"/*/proof.json >/dev/null 2>&1 || return 0
  "$OSASCRIPT" -l JavaScript "$EXPORTER" --index "$FOLDER" >/dev/null 2>&1 || true
}

clear_husks() {
  find "$FOLDER" -mindepth 1 -depth -type d -empty ! -name '.*' ! -name files \
    ! -path "$FOLDER/Recordings" \
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

# The digest state is WRITTEN but no longer consulted (1.8.0). Reading it is
# what made re-dropping a recorded file do nothing at all — no export rebuilt,
# no notification, no clue — because a digest recorded once was skipped
# silently forever, and the file survives uninstall so a reinstall looked
# broken the same way. Known bytes go through the pipeline on purpose now: the
# ledger lookup answers "on record", the export is rebuilt if missing, the
# duplicate is cleaned up, and the person is told. Skipping is unnecessary
# because the top level is empty at rest, and re-recording is impossible
# because the ledger dedupes by digest. The file stays as an append-only
# record of every digest this machine has handled.
handled() { grep -qxF "$1" "$STATE" 2>/dev/null || echo "$1" >> "$STATE"; }

# Everything droppable, including the contents of a folder someone dragged in.
#
# Dragging a folder of photos used to do NOTHING: the loop tested `-f` and moved
# on, with no log line and no notification, which is indistinguishable from a
# dead watcher. It is also the obvious thing to try, and the one thing a browser
# cannot offer, so the folder should be better at it than the website rather
# than worse.
#
# Ours are pruned rather than descended into: files/ (legacy, dissolved by the
# next index pass) held hard links to bytes already inside exports, .thumbs/ is
# generated, and any directory carrying a proof.json is an export. Recursive,
# because a folder of folders of photos is still a folder of photos.
droppable() {
  # Recordings/ is pruned by its exact top-level path, which both skips every
  # export in one test instead of one per directory and keeps a USER folder
  # that happens to be called Recordings, dragged in deeper down, recordable.
  find "$FOLDER" -mindepth 1 \
    \( -path "$FOLDER/Recordings" \
       -o -name '.*' \
       -o -name files \
       -o \( -type d -exec test -e '{}/proof.json' ';' \) \
    \) -prune -o -type f -print0
}

# Finish any export still waiting on the anchor that seals it. No wait here:
# this is housekeeping left by an earlier run, not the drop being handled now,
# and the run at the END of this script is the one that waits.
#
# ⚠️ ONLY WHEN SOMETHING IS ACTUALLY PENDING. This used to run unconditionally,
# and it is not cheap: it ends by rebuilding the contact sheet, which regenerates
# every proof page in the folder. Measured on a 44-export folder with nothing
# pending at all: 19.5 seconds, to seal zero. Every drop paid that before it was
# even looked at, and it grows with the folder.
#
# ⚠️ AND ONLY WHEN NOBODY IS ALREADY SEALING. A drop leaves its exports pending
# while a separate process waits for the anchor, so the very next drop would see
# "something is pending" and start a second full index rebuild alongside the one
# already running. That is duplicated work, on the path the person is waiting
# on, and it is why back-to-back drops still took ten seconds after the lock was
# split. Whoever holds the seal lock sweeps the whole folder, ours included.
if [ ! -d "$SEAL_LOCK" ] && { compgen -G "$FOLDER"/Recordings/*/.bitgraph-pending.json >/dev/null 2>&1 || compgen -G "$FOLDER"/*/.bitgraph-pending.json >/dev/null 2>&1; }; then
  "$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" 0 >/dev/null 2>&1 || true
fi

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

  # Everything present is processed, and deliberately WITHOUT consulting the
  # digest state (1.8.0): bytes already on the ledger deserve their "Already
  # on record" answer, an export rebuilt if it went missing, and their
  # duplicate cleaned up — re-dropping known bytes used to do nothing at all,
  # which is indistinguishable from a broken watcher. The top level is empty
  # at rest, so there is nothing here to re-hash on an ordinary fire; the
  # ledger dedupes by digest, so reprocessing can never re-record.
  before=$(stat -f '%z %m' "$f" 2>/dev/null) || continue
  digest=$(openssl dgst -sha256 -binary "$f" | base64)

  keep_paths+=("$f")
  keep_digests+=("$digest")
  keep_before+=("$before")
# Process substitution, not a pipe: a piped `while` runs in a subshell, so every
# variable it set would be discarded at the end of the loop.
done < <(droppable)

count=${#keep_paths[@]}
[ "$count" -eq 0 ] && { tuck_strays; clear_husks; exit 0; }

resp_file="$HOME_DIR/.response.json"

# Every reply is KEPT, not overwritten, because each one carries the full proofs
# for its chunk and the exporter would otherwise re-fetch every single one of
# them. Cleared at the start of the run and removed at the end.
RESPONSES="$HOME_DIR/.responses"
rm -rf "$RESPONSES"; mkdir -p "$RESPONSES"
resp_n=0

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
    if [ "$out" != "error" ]; then
      printf '%s\n' "$out" >> "$FOUND"
      resp_n=$((resp_n + 1)); cp "$resp_file" "$RESPONSES/$resp_n.json"
    fi
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
[ "$count" -eq 0 ] && { tuck_strays; clear_husks; exit 0; }

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
      resp_n=$((resp_n + 1)); cp "$resp_file" "$RESPONSES/$resp_n.json"
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

# ---- build the exports, in ONE exporter process ----------------------------
#
# ⚠️ One process for the whole drop, not one per file, and the reason is not
# process startup (that is 0.1s). It is that each export needs the proof, both
# bracketing anchors and a witness for each: five requests. One process per file
# meant a hundred-file drop issued five hundred of them, and nearly all asked
# for something already known. A batch commits within seconds, so it shares one
# anchor span and two block headers, and the proofs are sitting in the responses
# received above.
#
# So the manifest and the responses go in, and the exporter answers them from
# memory. Fields are NUL-separated because NUL is the one byte a filename cannot
# contain, and a newline is a byte it can.
MANIFEST="$HOME_DIR/.drop"
: > "$MANIFEST"
built_digests=()
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
  printf '%s\0%s\0%s\0%s\0' "$f" "$d" "$counter" "$epoch" >> "$MANIFEST"
  built_digests+=("$d")
  if grep -qF "$d$TAB" "$PRIOR"; then
    # These bytes were already on the ledger, so this drop was a lookup and
    # nothing new was minted. Same wording the site uses for the same case.
    log "on record  · $name · #$counter"
  else
    log "recorded #$counter · $name · $API/proof/$(to_urlsafe "$d")?counter=$counter&epoch=$epoch"
  fi
done

if [ "${#built_digests[@]}" -gt 0 ]; then
  result=$("$OSASCRIPT" -l JavaScript "$EXPORTER" --drop "$MANIFEST" "$FOLDER" "$RESPONSES" 2>&1)
  case "$result" in
    ok*) ;;
    *) log "drop: $result" ;;
  esac
  # ⚠️ Marked handled only after the exporter has run, never before. A digest
  # written here on a failed export would be skipped forever; see handled().
  # The exporter reports per-file failures on stderr and leaves those files in
  # place, so the worst case is re-exporting something already exported, which
  # buildExport answers with "already exported".
  for d in "${built_digests[@]}"; do handled "$d"; done
fi
rm -f "$MANIFEST"

# ---- seal and index, once --------------------------------------------------
#
# One wait covers the whole drop: anchors are time-based, so the anchor that
# lands after the last commit seals every proof in it. This also writes the
# contact sheet, so there is no separate index pass.
clear_husks

if [ $((recorded + on_record)) -gt 0 ]; then
  # ⚠️ THE DROP LOCK IS RELEASED FIRST. Everything the person is waiting for has
  # already happened: they were notified, the exports are written and the files
  # are moved. What is left is waiting on an anchor, and holding the lock
  # through it is what made the NEXT drop wait up to 45 seconds for a run.
  rm -rf "$LOCK" "$HOME_DIR/.response.json" "$HOME_DIR/.headers" "$HOME_DIR/.responses" \
         "$HOME_DIR/.found" "$HOME_DIR/.prior" "$HOME_DIR/.drop"

  # Only a fresh recording can still be waiting on an anchor. A drop of bytes
  # already on the ledger was sealed long ago, so it needs the index pass but
  # never the wait.
  wait_ms=0
  [ "$recorded" -gt 0 ] && wait_ms=45000

  # Skip if someone else is already sealing: the running sealer re-checks for
  # pending exports before it quits, so a drop that lands mid-seal is covered.
  #
  # ⚠️ DETACHED, and it SURVIVES this run ending, which needs both halves:
  # AbandonProcessGroup in the launch agent stops launchd killing it when the
  # main script exits, and the trap above not touching SEAL_LOCK stops a second
  # sealer starting while it works. Waiting on the anchor is the last thing that
  # happens and nobody is waiting for it: the person has been notified, the
  # exports are written and listed, the files are moved.
  #
  # The loop re-checks for pending work because a drop can land while the seal
  # wait is in progress, AFTER --complete listed the folder: that export would
  # otherwise stay pending with nothing scheduled to finish it. Bounded, so
  # anchoring being idle (the TEE at rest) cannot hold a sealer open forever.
  if mkdir "$SEAL_LOCK" 2>/dev/null; then
    (
      passes=0
      while [ "$passes" -lt 3 ] && { compgen -G "$FOLDER"/Recordings/*/.bitgraph-pending.json >/dev/null 2>&1 || compgen -G "$FOLDER"/*/.bitgraph-pending.json >/dev/null 2>&1; }; do
        "$OSASCRIPT" -l JavaScript "$EXPORTER" --complete "$FOLDER" "$wait_ms" >/dev/null 2>&1
        passes=$((passes + 1))
      done
      rm -rf "$SEAL_LOCK"
    ) &
    echo $! > "$SEAL_LOCK/pid" 2>/dev/null || true
    disown 2>/dev/null || true
  fi
fi

# Something arrived while this run was busy and was turned away. Go again rather
# than leaving it for a folder change that may never come. Bounded, so a folder
# being written to continuously cannot spin here forever; the next real change
# picks up whatever is left.
if [ -f "$HOME_DIR/.rescan" ]; then
  rm -f "$HOME_DIR/.rescan"
  rm -rf "$LOCK"
  depth="${BITGRAPH_RESCAN_DEPTH:-0}"
  if [ "$depth" -lt 5 ]; then
    export BITGRAPH_RESCAN_DEPTH=$((depth + 1))
    exec /bin/bash "$0"
  fi
fi
