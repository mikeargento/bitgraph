#!/bin/bash
# Build BitGraph Recorder.app.
#
# ⚠️ EXPAND THE BUILT APP AND LOOK INSIDE IT BEFORE RELEASING ANYTHING.
# Inspecting the source tree is not inspecting the build. A release burned on
# exactly this once: the version baked into the shipped page did not match the
# package, and its "check for updates" would have nagged forever.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
core="$here/../core"
version="$(tr -d '[:space:]' < "$here/VERSION")"
arch="${ARCH:-arm64}"
out="${OUT:-$here/build}"
app="$out/BitGraph Recorder.app"

say() { printf '\033[2m%s\033[0m\n' "$*"; }

say "BitGraph Recorder $version ($arch)"

# ── 1. the core ──────────────────────────────────────────────────────────────
say "building the core"
( cd "$core" && npm run build >/dev/null )

# ── 2. the shell ─────────────────────────────────────────────────────────────
say "building the app"
swift build --package-path "$here" -c release --arch "$arch" >/dev/null

# ── 3. the bundle ────────────────────────────────────────────────────────────
say "assembling the bundle"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/.build/$arch-apple-macosx/release/BitGraphRecorder" "$app/Contents/MacOS/BitGraphRecorder"
sed "s/__VERSION__/$version/g" "$here/Resources/Info.plist" > "$app/Contents/Info.plist"
cp "$here/Resources/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
# The name Finder and the Dock show (see Info.plist): read only from here.
mkdir -p "$app/Contents/Resources/en.lproj"
cp "$here/Resources/en.lproj/InfoPlist.strings" "$app/Contents/Resources/en.lproj/InfoPlist.strings"

# The core, with only what it needs at runtime: no TypeScript, no test runner.
say "installing the core's runtime dependencies"
staging="$(mktemp -d)"
cp "$core/package.json" "$core/package-lock.json" "$staging/"
( cd "$staging" && npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 )
mkdir -p "$app/Contents/Resources/core"
cp -R "$core/dist" "$app/Contents/Resources/core/dist"
cp -R "$staging/node_modules" "$app/Contents/Resources/core/node_modules"
cp "$core/package.json" "$app/Contents/Resources/core/package.json"
rm -rf "$staging"

# The runtime it runs on. Thinned to one architecture and stripped, then
# re-signed: stripping invalidates the signature and an unsigned Mach-O is
# killed on launch.
say "installing the runtime"
node_src="${NODE_BINARY:-$(command -v node)}"
lipo "$node_src" -thin "$arch" -output "$app/Contents/Resources/node" 2>/dev/null \
  || cp "$node_src" "$app/Contents/Resources/node"
strip -S "$app/Contents/Resources/node" 2>/dev/null || true
chmod +x "$app/Contents/Resources/node"

# ── 4. signing ───────────────────────────────────────────────────────────────
# Ad hoc by default so a local build runs. A release passes SIGN_IDENTITY and
# gets the hardened runtime; notarization and stapling are a separate step and
# need credentials this script deliberately does not hold.
identity="${SIGN_IDENTITY:--}"
extra=()
if [ "$identity" != "-" ]; then extra=(--options runtime --timestamp); fi
say "signing ($identity)"
# ⚠️ The runtime gets the SAME entitlements as the app. Under the hardened
# runtime a Node signed without allow-jit dies with "Trace/BPT trap: 5" the
# moment V8 starts; the first Developer ID build (2026-09-09) failed its own
# "the bundled runtime runs" check exactly there.
codesign --force --sign "$identity" "${extra[@]+"${extra[@]}"}" \
  --entitlements "$here/Resources/BitGraphRecorder.entitlements" \
  "$app/Contents/Resources/node" >/dev/null 2>&1
codesign --force --sign "$identity" "${extra[@]+"${extra[@]}"}" \
  --entitlements "$here/Resources/BitGraphRecorder.entitlements" \
  "$app" >/dev/null 2>&1

# ── 5. look inside what was actually built ───────────────────────────────────
say "checking the build"
fail=0
check() { if [ "$1" = "1" ]; then printf '  ok   %s\n' "$2"; else printf '  FAIL %s\n' "$2"; fail=1; fi }

[ -x "$app/Contents/MacOS/BitGraphRecorder" ] && check 1 "the executable is there" || check 0 "the executable is there"
[ -x "$app/Contents/Resources/node" ] && check 1 "the runtime is there" || check 0 "the runtime is there"
[ -f "$app/Contents/Resources/core/dist/cli.js" ] && check 1 "the core is there" || check 0 "the core is there"
[ -f "$app/Contents/Resources/AppIcon.icns" ] && check 1 "the icon is there" || check 0 "the icon is there"
/usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations:0:UTTypeIdentifier' "$app/Contents/Info.plist" 2>/dev/null | grep -q '^ing.bitgraph.evidence$' \
  && check 1 "the bundle claims .bitgraph" || check 0 "the bundle claims .bitgraph"

built_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || echo missing)"
[ "$built_version" = "$version" ] && check 1 "the bundle says version $version" || check 0 "the bundle says $built_version, VERSION says $version"

# The runtime inside the bundle has to actually run, not just exist.
if "$app/Contents/Resources/node" -e 'process.exit(0)' 2>/dev/null; then check 1 "the bundled runtime runs"; else check 0 "the bundled runtime runs"; fi

# And the core has to load through it, with only the dependencies that shipped.
if "$app/Contents/Resources/node" "$app/Contents/Resources/core/dist/cli.js" --help >/dev/null 2>&1; then
  check 1 "the bundled core answers --help"
else
  check 0 "the bundled core answers --help"
fi

if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then check 1 "the signature verifies"; else check 0 "the signature verifies"; fi

size="$(du -sh "$app" | cut -f1)"
say "$app  ($size)"
exit "$fail"
