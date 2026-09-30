#!/usr/bin/env bash
# Ad-hoc signs an unsigned Mac App Store build with the App Store entitlements, so CI can launch it
# inside the App Sandbox without Apple certificates. The real store build is signed by
# electron-builder with the Apple Distribution certificate instead (see .github/workflows/app-store.yml).
#   release/mas-adhoc-sign.sh release/out/mas-arm64/Fretlane.app
set -euo pipefail
app="$1"
ent=build/entitlements.mas.plist
inherit=build/entitlements.mas.inherit.plist
# Inside out: frameworks and helper apps inherit the sandbox, then the app itself gets it.
for item in "$app"/Contents/Frameworks/*; do
  codesign --force --deep --sign - --entitlements "$inherit" "$item"
done
codesign --force --sign - --entitlements "$ent" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -d --entitlements - "$app" 2>/dev/null | grep -q 'com.apple.security.app-sandbox' || { echo 'app-sandbox entitlement missing'; exit 1; }
echo "Signed $app (ad-hoc, sandboxed)"
