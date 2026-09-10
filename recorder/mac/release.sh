#!/bin/bash
# Release BitGraph Recorder: signed build → notarize → staple → installer
# package → notarize the package → staple → checksum → update feed. Everything
# a download needs, in one run.
#
#   mac/release.sh            builds into mac/release/ (never over a running build/)
#
# ⚠️ NO SECRETS HERE. Signing uses the Developer ID Application and Installer
# identities in the login keychain and notarization uses the keychain profile named `notary`
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
installer="${INSTALLER_IDENTITY:-Developer ID Installer: Michael Argento (8HP853ALXL)}"
profile="${NOTARY_PROFILE:-notary}"
out="${OUT:-$here/release}"
app="$out/BitGraph Recorder.app"
pkg="$out/BitGraph-Recorder-$version.pkg"
zip="$out/BitGraph Recorder.zip"
bundle_id="ing.bitgraph.recorder"

say() { printf '\033[2m%s\033[0m\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

say "releasing BitGraph Recorder $version"
security find-identity -v -p codesigning | grep -q "$identity" || die "identity not in the keychain: $identity"
security find-identity -v | grep -q "$installer" || die "installer identity not in the keychain: $installer"
mkdir -p "$out"
rm -f "$pkg" "$zip" "$out"/*.dmg "$out"/*.sha256

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

# ── 3. the installer package: the app, into /Applications ──────────────────
# A package rather than a drag-to-install DMG (Mike, 2026-09-10: "there's no
# installer?"): the standard Installer puts the app where it goes, replaces an
# older version on update, and works with the tools institutions deploy with.
say "building the installer package"
pkgbuild --component "$app" --install-location /Applications \
  --identifier "$bundle_id" --version "$version" \
  --sign "$installer" --timestamp "$pkg" >/dev/null

# ── 4. notarize the package too, so it opens without a word ─────────────────
say "notarizing the package"
xcrun notarytool submit "$pkg" --keychain-profile "$profile" --wait 2>&1 | grep -E "^  status:" | tail -1 | grep -q "Accepted" || die "the package was not accepted by the notary service"
xcrun stapler staple "$pkg" >/dev/null
xcrun stapler validate "$pkg" >/dev/null || die "the package's ticket did not staple"
spctl --assess --type install "$pkg" 2>/dev/null || die "Gatekeeper does not accept the stapled package"
pkgutil --check-signature "$pkg" 2>/dev/null | grep -q "Developer ID Installer" || die "the package is not signed with the Installer identity"

# ── 5. look inside the package, not the tree it came from ───────────────────
say "checking the package"
x="$(mktemp -d)/x"
pkgutil --expand "$pkg" "$x"
# ⚠️ The plain `version=` attribute, with the space before it. The element also
# carries format-version and generator-version, and a greedy match took the
# generator's build number for the package's version (first run, 2026-09-10).
inner_version="$(sed -n 's/.*<pkg-info[^>]* version="\([^"]*\)".*/\1/p' "$x/PackageInfo" | head -1)"
[ "$inner_version" = "$version" ] || die "the package says $inner_version, VERSION says $version"
grep -q 'install-location="/Applications"' "$x/PackageInfo" || die "the package does not install to /Applications"
# The app inside, byte for byte. ⚠️ --expand-full, never gunzip+cpio by hand:
# the hand unpack dropped enough that the app inside failed codesign on the
# second run (2026-09-10), while the package itself was fine.
p="$(mktemp -d)/full"
pkgutil --expand-full "$pkg" "$p"
inner="$p/Payload/BitGraph Recorder.app"
[ -d "$inner" ] || die "the package's payload holds no app"
app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$inner/Contents/Info.plist")"
[ "$app_version" = "$version" ] || die "the app inside the package says $app_version"
codesign --verify --deep --strict "$inner" 2>/dev/null || die "the app inside the package does not verify"
xcrun stapler validate "$inner" >/dev/null || die "the app inside the package carries no ticket"
rm -rf "$x" "$(dirname "$p")"
say "  ok   the package installs BitGraph Recorder $version to /Applications, notarized, ticket stapled"

sha="$(shasum -a 256 "$pkg" | cut -d' ' -f1)"
printf '%s  %s\n' "$sha" "$(basename "$pkg")" | tee "$pkg.sha256"
say "$pkg  ($(du -h "$pkg" | cut -f1))"

# ── 6. the update feed, from the artifact just checked ──────────────────────
# The app reads website/public/recorder/latest.json (served at
# bitgraph.ing/recorder/latest.json) and is TOLD a newer version exists; it
# never installs one. Version, URL and checksum come from THIS run, so the feed
# cannot name a build that was not checked. ⚠️ The site commits and pushes it;
# the release is not announced until that push. And the GitHub Release must
# exist first, since the URL below is its permanent latest-asset address.
feed="$here/../../website/public/recorder/latest.json"
cat > "$feed" <<JSON
{
  "version": "$version",
  "url": "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraph-Recorder.pkg",
  "notes": "https://github.com/mikeargento/bitgraph/releases/tag/recorder-v$version",
  "sha256": "$sha",
  "minimumSystemVersion": "14.0",
  "publishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
say "  ok   wrote $feed (commit and push the site to announce $version)"
say "next: cp \"$pkg\" \"$out/BitGraph-Recorder.pkg\" && gh release create recorder-v$version \"$pkg\" \"$out/BitGraph-Recorder.pkg\" \"$pkg.sha256\" --title \"BitGraph Recorder $version\""
