#!/bin/bash
# Release BitGraph Recorder: signed build → notarize → staple → DMG → notarize
# the DMG → staple → checksum. Everything a download needs, in one run.
#
#   mac/release.sh            builds into mac/release/ (never over a running build/)
#
# ⚠️ NO SECRETS HERE. Signing uses the Developer ID Application identity in the
# login keychain and notarization uses the keychain profile named `notary`
# (made once with `xcrun notarytool store-credentials notary`). Both are the
# machine's, not the repository's.
#
# ⚠️ LOOK INSIDE WHAT WAS BUILT. Every step below re-checks the artifact it just
# made rather than trusting the step before it, because a release once shipped
# with a version that did not match its package (see build.sh).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
version="$(tr -d '[:space:]' < "$here/VERSION")"
identity="${SIGN_IDENTITY:-Developer ID Application: Michael Argento (8HP853ALXL)}"
profile="${NOTARY_PROFILE:-notary}"
out="${OUT:-$here/release}"
app="$out/BitGraph Recorder.app"
dmg="$out/BitGraph-Recorder-$version.dmg"
zip="$out/BitGraph Recorder.zip"

say() { printf '\033[2m%s\033[0m\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

say "releasing BitGraph Recorder $version"
security find-identity -v -p codesigning | grep -q "$identity" || die "identity not in the keychain: $identity"
mkdir -p "$out"
rm -f "$dmg" "$zip"

# ── 1. the signed build, checked by build.sh itself ─────────────────────────
OUT="$out" SIGN_IDENTITY="$identity" "$here/build.sh"

# ── 2. notarize the app ─────────────────────────────────────────────────────
say "notarizing the app"
ditto -c -k --keepParent "$app" "$zip"
xcrun notarytool submit "$zip" --keychain-profile "$profile" --wait 2>&1 | grep -E "^  status:" | tail -1 | grep -q "Accepted" || die "the app was not accepted by the notary service"
rm -f "$zip"
xcrun stapler staple "$app" >/dev/null
xcrun stapler validate "$app" >/dev/null || die "the app's ticket did not staple"
spctl --assess --type execute "$app" 2>/dev/null || die "Gatekeeper does not accept the stapled app"
say "  ok   the app is notarized and stapled"

# ── 3. the DMG: the app and a link to Applications ──────────────────────────
say "building the DMG"
stage="$(mktemp -d)"
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
hdiutil create -volname "BitGraph Recorder" -srcfolder "$stage" -ov -format UDZO -quiet "$dmg"
rm -rf "$stage"
codesign --force --sign "$identity" --timestamp "$dmg" >/dev/null 2>&1

# ── 4. notarize the DMG too, so the download opens without a word ───────────
say "notarizing the DMG"
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait 2>&1 | grep -E "^  status:" | tail -1 | grep -q "Accepted" || die "the DMG was not accepted by the notary service"
xcrun stapler staple "$dmg" >/dev/null
xcrun stapler validate "$dmg" >/dev/null || die "the DMG's ticket did not staple"

# ── 5. look inside the DMG, not the tree it came from ───────────────────────
say "checking the DMG"
mnt="$(mktemp -d)"
hdiutil attach "$dmg" -mountpoint "$mnt" -nobrowse -quiet
inner="$mnt/BitGraph Recorder.app"
[ -d "$inner" ] || die "the DMG holds no app"
built_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$inner/Contents/Info.plist")"
[ "$built_version" = "$version" ] || die "the DMG's app says $built_version, VERSION says $version"
spctl --assess --type execute "$inner" 2>/dev/null || die "Gatekeeper does not accept the app inside the DMG"
xcrun stapler validate "$inner" >/dev/null || die "the app inside the DMG carries no ticket"
hdiutil detach "$mnt" -quiet
rmdir "$mnt"
say "  ok   the DMG holds BitGraph Recorder $version, notarized, ticket stapled"

shasum -a 256 "$dmg" | tee "$dmg.sha256"
say "$dmg  ($(du -h "$dmg" | cut -f1))"
