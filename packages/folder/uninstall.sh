#!/bin/bash
# BitGraph Folder uninstaller.
#
# Stops and removes the watcher. Your folder, your files, and your export
# folders are never touched: they are yours, and the proofs inside them stay
# valid and auditable with or without this tool installed.

set -euo pipefail

HOME_DIR="${BITGRAPH_HOME:-$HOME/.bitgraph}"
FOLDER="${BITGRAPH_FOLDER:-$HOME/BitGraph}"
LINK="${BITGRAPH_LINK:-$HOME/Desktop/BitGraph}"
LABEL="com.bitgraph.hotfolder"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Prefer the installed config over the defaults above, so a custom location is
# actually found rather than silently left running.
# shellcheck source=/dev/null
[ -f "$HOME_DIR/config" ] && . "$HOME_DIR/config"

say() { printf '  %s\n' "$1"; }

printf '\nRemoving BitGraph Folder\n\n'

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null && say "watcher stopped" || say "watcher was not running"

rm -f "$PLIST" && say "launch agent removed"

# Only remove the link if it is in fact our symlink. A real folder someone put
# there is theirs, not ours to delete.
if [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$FOLDER" ]; then
  rm "$LINK"
  say "desktop link removed"
fi

rm -f "$HOME_DIR/hotfolder.sh" "$HOME_DIR/export.js" "$HOME_DIR/config" "$HOME_DIR/hotfolder.err"
rmdir "$HOME_DIR" 2>/dev/null || true
say "scripts removed"

printf '\nDone.\n\n'
printf 'Left alone on purpose:\n\n'
printf '  %s\n' "$FOLDER"
printf '    Your files and every export folder in it. The proofs inside stay\n'
printf '    valid and auditable without this tool. Delete it yourself if you\n'
printf '    want it gone.\n\n'
if [ -f "$HOME_DIR/hotfolder.state" ]; then
  printf '  %s\n' "$HOME_DIR/hotfolder.state"
  printf '    The list of digests already handled, kept so a reinstall does not\n'
  printf '    re-check everything.\n\n'
  printf '    DELETE THIS if you are reinstalling to test a first run. A digest\n'
  printf '    listed here is skipped silently, so re-dropping a file you have\n'
  printf '    already recorded does nothing at all, which reads as a broken\n'
  printf '    install when it is the opposite.\n\n'
fi
printf 'Recordings already on the ledger are permanent and are not affected by\n'
printf 'uninstalling.\n\n'
