#!/bin/bash
# Build a signed, notarized, stapled BitGraphFolder.pkg.
#
# Requires:
#   - a "Developer ID Installer" identity in the keychain
#   - a stored notarytool profile (xcrun notarytool store-credentials)
#
# Nothing secret lives in this script. The signing key stays in the keychain and
# the notarization credential is referenced by profile name, so this file is
# safe to commit.
#
#   ./build-pkg.sh            build, sign, notarize, staple
#   ./build-pkg.sh --no-sign  build an unsigned pkg (for local testing only)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# One source of truth, shared with install.sh, so the number the installer
# reports and the number on the downloaded file can never drift apart.
VERSION="${BITGRAPH_PKG_VERSION:-$(cat "$HERE/VERSION")}"
# The site advertises the current release to installed Folders, as a header on
# /api/commit. Rewriting it here, from the same VERSION, is what stops it
# drifting behind: you cannot cut a release without updating what the release
# announces. Committing the change is still on the releaser.
SITE_VERSION_FILE="$HERE/../../website/src/lib/folder-version.ts"
if [ -f "$SITE_VERSION_FILE" ]; then
  /usr/bin/sed -i '' -E "s/^export const FOLDER_VERSION = \".*\";$/export const FOLDER_VERSION = \"$VERSION\";/" "$SITE_VERSION_FILE"
fi
IDENTIFIER="ing.bitgraph.folder"
INSTALL_LOCATION="/usr/local/lib/bitgraph-folder"
NOTARY_PROFILE="${BITGRAPH_NOTARY_PROFILE:-notary}"
OUT="$HERE/dist"
PKG="$OUT/BitGraphFolder-$VERSION.pkg"

SIGN=1
[ "${1:-}" = "--no-sign" ] && SIGN=0

say() { printf '  %s\n' "$1"; }

rm -rf "$OUT"
mkdir -p "$OUT"

# --- Stage the payload ----------------------------------------------------

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
STAGE="$ROOT$INSTALL_LOCATION"
mkdir -p "$STAGE/src"

install -m 0755 "$HERE/install.sh"   "$STAGE/install.sh"
install -m 0755 "$HERE/uninstall.sh" "$STAGE/uninstall.sh"
install -m 0644 "$HERE/LICENSE"      "$STAGE/LICENSE"
# install.sh reads this to report the version and to write BITGRAPH_VERSION into
# the user's config. It was never staged, so every installed copy said
# "BitGraph Folder unknown" and recorded unknown as its version.
install -m 0644 "$HERE/VERSION"      "$STAGE/VERSION"
install -m 0644 "$HERE/README.md"    "$STAGE/README.md"
install -m 0755 "$HERE/src/hotfolder.sh" "$STAGE/src/hotfolder.sh"
install -m 0644 "$HERE/src/export.js"    "$STAGE/src/export.js"
install -m 0644 "$HERE/src/com.bitgraph.hotfolder.plist" "$STAGE/src/com.bitgraph.hotfolder.plist"

SCRIPTS="$ROOT-scripts"
mkdir -p "$SCRIPTS"
install -m 0755 "$HERE/pkg/postinstall" "$SCRIPTS/postinstall"

printf '\nBuilding BitGraphFolder %s\n\n' "$VERSION"
say "payload       $INSTALL_LOCATION"

# --- Build ----------------------------------------------------------------

pkgbuild \
  --root "$ROOT" \
  --scripts "$SCRIPTS" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT/component.pkg" >/dev/null

if [ "$SIGN" = "1" ]; then
  IDENTITY="$(security find-identity -v | grep "Developer ID Installer" | head -1 | sed 's/.*"\(.*\)"/\1/')"
  [ -n "$IDENTITY" ] || { echo "No Developer ID Installer identity found." >&2; exit 1; }
  say "signing as    $IDENTITY"
  productbuild --package "$OUT/component.pkg" --sign "$IDENTITY" "$PKG" >/dev/null
else
  say "signing       skipped (--no-sign)"
  productbuild --package "$OUT/component.pkg" "$PKG" >/dev/null
fi
rm -f "$OUT/component.pkg"
rm -rf "$SCRIPTS"
say "built         $PKG"

[ "$SIGN" = "1" ] || { printf '\nUnsigned build done. Not distributable.\n\n'; exit 0; }

# --- Notarize -------------------------------------------------------------

say "notarizing    (Apple scans the package, usually under a few minutes)"
xcrun notarytool submit "$PKG" --keychain-profile "$NOTARY_PROFILE" --wait

# Stapling attaches the notarization ticket to the file itself, so Gatekeeper
# clears it even on a machine that is offline when the user opens it.
xcrun stapler staple "$PKG"

printf '\nDone.\n\n'
say "$PKG"
printf '\nVerify what a downloader would see:\n\n'
printf '  spctl --assess -vv --type install %s\n' "$PKG"
printf '  pkgutil --check-signature %s\n\n' "$PKG"
