#!/usr/bin/env bash
# Ad-hoc signs an unsigned Mac App Store build with the App Store entitlements, so CI can launch it
# inside the App Sandbox without Apple certificates. The real store build is signed by
# electron-builder with the Apple Distribution certificate instead (see .github/workflows/app-store.yml).
#   release/mas-adhoc-sign.sh release/out/mas-arm64/Fretlane.app [TEAMID]
# The team ID must match ElectronTeamID in the app's Info.plist: sandboxed Chromium may only
# register Mach services under an application group, "<TEAMID>.<bundle id>".
set -euo pipefail
app="$1"
team="${2:-ADHOCTEAM1}"
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
inherit=build/entitlements.mas.inherit.plist
ent=$(mktemp -t fretlane-ent).plist
cp build/entitlements.mas.plist "$ent"
/usr/libexec/PlistBuddy -c 'Add :com.apple.security.application-groups array' \
  -c "Add :com.apple.security.application-groups:0 string $team.$bundle" "$ent"
# Inside out: frameworks and helper apps inherit the sandbox, then the app itself gets it.
for item in "$app"/Contents/Frameworks/*; do
  codesign --force --deep --sign - --entitlements "$inherit" "$item"
done
# The MAS build's login helper is a standalone app: it can't inherit, so it gets the app's sandbox.
for item in "$app"/Contents/Library/LoginItems/*.app; do
  [ -e "$item" ] && codesign --force --deep --sign - --entitlements "$ent" "$item"
done
codesign --force --sign - --entitlements "$ent" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -d --entitlements - "$app" 2>/dev/null | grep -q 'com.apple.security.app-sandbox' || { echo 'app-sandbox entitlement missing'; exit 1; }
echo "Signed $app (ad-hoc, sandboxed)"
