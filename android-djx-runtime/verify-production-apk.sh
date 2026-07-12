#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_FILE="${SKIT_PRODUCTION_PROFILE:-$ROOT_DIR/android-djx-runtime/production-profile.json}"
APK_FILE="${APK_FILE:-${1:-$ROOT_DIR/dist/xingheyingguan-debug.apk}}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

fail() {
  echo "Production APK verification failed: $*" >&2
  exit 1
}

profile_value() {
  python3 - "$PROFILE_FILE" "$1" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

[[ -f "$PROFILE_FILE" ]] || fail "missing profile $PROFILE_FILE"
[[ -f "$APK_FILE" ]] || fail "missing APK $APK_FILE"

PROFILE_ID="$(profile_value profileId)"
EXPECTED_PACKAGE="$(profile_value applicationId)"
EXPECTED_ASSET="$(profile_value pangle.settingsAsset)"
EXPECTED_SITE_ID="$(profile_value pangle.siteId)"
EXPECTED_CONTENT_APP_ID="$(profile_value pangle.contentAppId)"
EXPECTED_PANGLE_AD_SDK_VERSION="$(profile_value pangle.adSdkVersion)"
EXPECTED_PANGLE_CONTENT_SDK_VERSION="$(profile_value pangle.contentSdkVersion)"
EXPECTED_TAKU_APP_ID="$(profile_value taku.appId)"
EXPECTED_TAKU_PLACEMENT_ID="$(profile_value taku.rewardPlacementId)"
EXPECTED_TAKU_SDK_VERSION="$(profile_value taku.sdkVersion)"

AAPT="${AAPT:-}"
if [[ -z "$AAPT" ]]; then
  AAPT="$(find "$ANDROID_HOME/build-tools" -type f -name aapt 2>/dev/null | sort -V | tail -1)"
fi
[[ -x "$AAPT" ]] || fail "aapt not found under $ANDROID_HOME/build-tools"

ACTUAL_PACKAGE="$($AAPT dump badging "$APK_FILE" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
[[ "$ACTUAL_PACKAGE" == "$EXPECTED_PACKAGE" ]] || \
  fail "package is $ACTUAL_PACKAGE, expected $EXPECTED_PACKAGE"

APK_ENTRIES="$(unzip -Z1 "$APK_FILE")"
APK_SETTINGS="$(printf '%s\n' "$APK_ENTRIES" | grep -E '^assets/SDK_Setting[^/]*\.json$' || true)"
APK_SETTING_COUNT="$(printf '%s\n' "$APK_SETTINGS" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "$APK_SETTING_COUNT" -eq 1 ]] || fail "APK contains $APK_SETTING_COUNT SDK settings assets"
[[ "$APK_SETTINGS" == "assets/$EXPECTED_ASSET" ]] || \
  fail "APK contains $APK_SETTINGS, expected assets/$EXPECTED_ASSET"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
unzip -p "$APK_FILE" "assets/$EXPECTED_ASSET" > "$TMP_DIR/settings.json"

python3 - "$TMP_DIR/settings.json" "$EXPECTED_SITE_ID" "$EXPECTED_CONTENT_APP_ID" "$EXPECTED_PACKAGE" <<'PY'
import json
import sys

path, expected_site, expected_app, expected_package = sys.argv[1:]
profile = json.load(open(path, encoding="utf-8"))
actual_site = str(profile.get("init", {}).get("site_id", ""))
actual_app = str(profile.get("init", {}).get("app_id", ""))
packages = {str(item.get("PackageName", "")) for item in profile.get("license_config") or []}
if actual_site != expected_site:
    raise SystemExit(f"site_id is {actual_site}, expected {expected_site}")
if actual_app != expected_app:
    raise SystemExit(f"content app_id is {actual_app}, expected {expected_app}")
if expected_package not in packages:
    raise SystemExit(f"license does not include package {expected_package}")
PY

FRONTEND_REFS="$({
  while IFS= read -r js_file; do
    unzip -p "$APK_FILE" "$js_file"
  done < <(printf '%s\n' "$APK_ENTRIES" | grep -E '^assets/www/assets/.*\.js$' || true)
} | grep -aoE 'SDK_Setting(_[0-9]+)?\.json' | sort -u || true)"
[[ -n "$FRONTEND_REFS" ]] || fail "frontend contains no SDK settings reference"
while IFS= read -r frontend_ref; do
  [[ "$frontend_ref" == "$EXPECTED_ASSET" ]] || \
    fail "frontend references $frontend_ref, expected only $EXPECTED_ASSET"
done <<< "$FRONTEND_REFS"

DEX_STRINGS="$TMP_DIR/dex-strings.txt"
unzip -p "$APK_FILE" 'classes*.dex' | strings > "$DEX_STRINGS"
grep -Fq 'Lcom/bytedance/sdk/djx/DJXSdk;' "$DEX_STRINGS" || fail "Pangle DJXSdk class missing"
grep -Fq 'Lcom/anythink/rewardvideo/api/ATRewardVideoAd;' "$DEX_STRINGS" || fail "Taku rewarded-video class missing"
grep -Fq "$EXPECTED_PANGLE_AD_SDK_VERSION" "$DEX_STRINGS" || \
  fail "Pangle ad SDK version $EXPECTED_PANGLE_AD_SDK_VERSION missing"
grep -Fq "$EXPECTED_PANGLE_CONTENT_SDK_VERSION" "$DEX_STRINGS" || \
  fail "Pangle content SDK version $EXPECTED_PANGLE_CONTENT_SDK_VERSION missing"
grep -Fq "UA_$EXPECTED_TAKU_SDK_VERSION" "$DEX_STRINGS" || \
  fail "Taku SDK version $EXPECTED_TAKU_SDK_VERSION missing"
grep -Fq "$EXPECTED_TAKU_APP_ID" "$DEX_STRINGS" || fail "Taku app ID missing from runtime"
grep -Fq "$EXPECTED_TAKU_PLACEMENT_ID" "$DEX_STRINGS" || fail "Taku placement ID missing from runtime"

SHA256="$(shasum -a 256 "$APK_FILE" | awk '{print $1}')"
echo "Production APK verified"
echo "profile=$PROFILE_ID"
echo "package=$EXPECTED_PACKAGE"
echo "pangle_site=$EXPECTED_SITE_ID content_app=$EXPECTED_CONTENT_APP_ID asset=$EXPECTED_ASSET ad_sdk=$EXPECTED_PANGLE_AD_SDK_VERSION content_sdk=$EXPECTED_PANGLE_CONTENT_SDK_VERSION"
echo "taku_app=$EXPECTED_TAKU_APP_ID placement=$EXPECTED_TAKU_PLACEMENT_ID sdk=$EXPECTED_TAKU_SDK_VERSION"
echo "sha256=$SHA256"
