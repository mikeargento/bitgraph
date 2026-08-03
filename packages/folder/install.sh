#!/bin/bash
# BitGraph Folder installer.
#
# Creates the watched folder, links it onto the Desktop, installs the watcher
# and exporter, and loads the launchd agent. Everything lands under your home
# directory. Nothing is written outside it, and nothing needs sudo.
#
# Re-running this is safe: it replaces the scripts and reloads the agent without
# touching the folder, your exports, or the record of what has already been
# recorded.

set -euo pipefail

FOLDER="${BITGRAPH_FOLDER:-$HOME/BitGraph}"
HOME_DIR="${BITGRAPH_HOME:-$HOME/.bitgraph}"
API="${BITGRAPH_API:-https://bitgraph.ing}"
LINK="${BITGRAPH_LINK:-$HOME/Desktop/BitGraph}"
LABEL="com.bitgraph.hotfolder"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"
# There is no auto-update by design, so the installed version has to be
# discoverable. Someone reporting a problem needs to be able to say what they
# are running, and to tell whether re-downloading would actually change
# anything.
VERSION="$(cat "$HERE/VERSION" 2>/dev/null || echo "unknown")"

say() { printf '  %s\n' "$1"; }
die() { printf '\nInstall stopped: %s\n\n' "$1" >&2; exit 1; }

printf '\nBitGraph Folder %s\n\n' "${VERSION:-}"

# --- Checks ---------------------------------------------------------------

[ "$(uname -s)" = "Darwin" ] || die "this needs macOS. It uses launchd to watch the folder."

# Nothing to detect. The exporter runs under JavaScript for Automation, which
# has shipped with macOS since 10.10, so there is no runtime to install and
# nothing that can be missing.
[ -x /usr/bin/osascript ] || die "/usr/bin/osascript is missing. This is not a stock macOS system."

# --- Install --------------------------------------------------------------

mkdir -p "$FOLDER" "$HOME_DIR" "$HOME/Library/LaunchAgents"

install -m 0755 "$SRC/hotfolder.sh" "$HOME_DIR/hotfolder.sh"
install -m 0644 "$SRC/export.js" "$HOME_DIR/export.js"

# Installing over an older version leaves its files behind otherwise. 1.0.x
# shipped a Node exporter that 1.1.0 replaced; a stale copy is dead weight and
# is confusing to find later while debugging.
rm -f "$HOME_DIR/export.mjs"
rm -rf "$HOME_DIR/exporter"

cat > "$HOME_DIR/config" <<EOF
# BitGraph Folder configuration. Edit and re-run install.sh to apply.
BITGRAPH_VERSION="$VERSION"
BITGRAPH_FOLDER="$FOLDER"
BITGRAPH_HOME="$HOME_DIR"
BITGRAPH_API="$API"
EOF
chmod 0600 "$HOME_DIR/config"

sed -e "s|__SCRIPT__|$HOME_DIR/hotfolder.sh|g" \
    -e "s|__FOLDER__|$FOLDER|g" \
    -e "s|__ERRLOG__|$HOME_DIR/hotfolder.err|g" \
    "$SRC/$LABEL.plist" > "$PLIST"

say "folder        $FOLDER"
say "watcher       $HOME_DIR/hotfolder.sh"

# The Desktop item is a symlink, and that is load-bearing rather than cosmetic.
# macOS TCC denies background launchd agents access to ~/Desktop, ~/Documents,
# and ~/Downloads. A watcher pointed straight at a Desktop folder runs, exits 0,
# and silently sees nothing. Keeping the real folder outside those directories
# and linking to it means Finder drops land somewhere the agent can actually
# read, with no permission prompt.
if [ -L "$LINK" ]; then
  say "desktop link  $LINK (already present)"
elif [ -e "$LINK" ]; then
  say "desktop link  skipped, something already exists at $LINK"
else
  ln -s "$FOLDER" "$LINK"
  say "desktop link  $LINK"
fi

# --- Load the agent -------------------------------------------------------

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

printf '\nInstalled. Drop a file into the BitGraph folder on your Desktop.\n\n'
cat <<'EOF'
What happens on a drop

  The file is hashed on your machine. Only the SHA-256 digest is sent, never
  the file. If those bytes are already on record you get the existing proof
  back; if not, they are recorded at a new causal position.

  The file is then MOVED into an export folder beside it:

      bitgraph-proof-1858/
          proof.json
          your-file.jpg
          ethereum-anchors/

  Audit any export offline, no network needed:

      npx @mikeargento/bitgraph-audit bitgraph-proof-1858

Worth knowing

  Recordings are permanent and public. The ledger has no deletes. Put files
  in this folder only when you mean to record them.

To remove it

  ./uninstall.sh

EOF
