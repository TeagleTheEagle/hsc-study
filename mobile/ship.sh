#!/usr/bin/env bash
# Bands for Days: one command for the iPhone app (see MOBILE.md).
#
#   ./ship.sh team AB12CD34EF   remember your Apple Team ID (once; it goes in mobile/.team, which git ignores)
#   ./ship.sh phone             build the app and put it on the iPhone plugged into this Mac
#   ./ship.sh testflight        build a release, sign it and upload it to App Store Connect (TestFlight / review)
#
# Needs: Xcode (opened once, licence accepted), your Apple ID signed in under Xcode > Settings > Accounts,
# and `npm install` done in this folder. Everything else is automatic signing through Xcode.
set -euo pipefail
cd "$(dirname "$0")"
PROJ=ios/App/App.xcodeproj
BUNDLE=com.bandsfordays.app
TEAM_FILE=.team
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

cmd="${1:-help}"
case "$cmd" in
  team)
    [[ "${2:-}" =~ ^[A-Z0-9]{10}$ ]] || die "Usage: ./ship.sh team AB12CD34EF   (10 capital letters and digits, from developer.apple.com/account > Membership details)"
    echo "$2" > "$TEAM_FILE"; say "Team ID saved. Now run ./ship.sh phone or ./ship.sh testflight"; exit 0 ;;
  phone|testflight) ;;
  *) sed -n '2,8p' "$0"; exit 0 ;;
esac

command -v xcodebuild >/dev/null || die "Xcode is not installed, or has not been opened once. Install it from the Mac App Store, open it, accept the licence, then run this again."
TEAM=Y89NN5A4T6   # Mr Teague's Apple Team ID (public); ./ship.sh team X overrides it through mobile/.team
[ -f "$TEAM_FILE" ] && TEAM=$(tr -d '[:space:]' < "$TEAM_FILE")
[ -d node_modules/@capacitor/ios ] || { say "Installing packages"; npm install; }
say "Syncing the iOS project"; npx cap sync ios
BUILD_NO=$(date +%Y%m%d%H%M)   # every upload needs a higher build number; the minute of the build does that
COMMON=(-project "$PROJ" -scheme App -destination 'generic/platform=iOS' DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NO" -allowProvisioningUpdates -allowProvisioningDeviceRegistration)

if [ "$cmd" = phone ]; then
  say "Looking for your iPhone (plug it in with a cable, unlock it, tap Trust)"
  xcrun devicectl list devices --json-output build-devices.json >/dev/null 2>&1 || die "Could not list devices. Is Xcode fully installed?"
  DEV=$(python3 - <<'PY'
import json
d=json.load(open('build-devices.json'))
for x in d.get('result',{}).get('devices',[]):
    hw=x.get('hardwareProperties',{}); cp=x.get('connectionProperties',{})
    if hw.get('platform')=='iOS' and cp.get('pairingState')=='paired' and cp.get('tunnelState')!='unavailable':
        print(x['identifier']); break
PY
)
  rm -f build-devices.json
  [ -n "$DEV" ] || die "No paired iPhone found. Plug it in, unlock it, tap Trust This Computer, and on the phone turn on Settings > Privacy & Security > Developer Mode (restart), then run this again."
  say "Building the app (the first time takes a few minutes)"
  mkdir -p build
  xcodebuild "${COMMON[@]}" -configuration Debug -derivedDataPath build build 2>&1 | tee build/phone.log | grep -E 'error:|BUILD ' || true
  APP=build/Build/Products/Debug-iphoneos/App.app
  [ -d "$APP" ] || { tail -n 40 build/phone.log; die "The build failed. Copy the lines above (or mobile/build/phone.log) and send them to Claude."; }
  say "Installing on the iPhone"; xcrun devicectl device install app --device "$DEV" "$APP"
  say "Opening it"; xcrun devicectl device process launch --device "$DEV" "$BUNDLE" || true
  say "Done. Bands for Days should be open on the phone. If it says Untrusted Developer: Settings > General > VPN & Device Management > trust, then open it again."
  exit 0
fi

# testflight
say "Building the release and signing it"
mkdir -p build; rm -rf build/App.xcarchive
xcodebuild "${COMMON[@]}" -configuration Release -archivePath build/App.xcarchive archive 2>&1 | tee build/archive.log | grep -E 'error:|ARCHIVE ' || true
[ -d build/App.xcarchive ] || { tail -n 40 build/archive.log; die "The archive failed. Copy the lines above (or mobile/build/archive.log) and send them to Claude."; }
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
say "Uploading to App Store Connect (build $BUILD_NO); this can take several minutes"
xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist build/ExportOptions.plist -exportPath build/export -allowProvisioningUpdates 2>&1 | tee build/upload.log | grep -E 'error:|EXPORT |Upload' || true
grep -q 'EXPORT SUCCEEDED' build/upload.log || { tail -n 40 build/upload.log; die "The upload failed. Copy the lines above (or mobile/build/upload.log) and send them to Claude."; }
say "If it said EXPORT SUCCEEDED, the build is on its way. In 10 to 30 minutes it appears at appstoreconnect.apple.com > Apps > Bands for Days > TestFlight."
