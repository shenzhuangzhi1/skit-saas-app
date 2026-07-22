#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: verify-agent-apk.sh --project <skit-saas-app-dir> --profile <PROFILE_CODE> --apk <path>"
}

PROJECT_DIR=""
PROFILE_CODE=""
APK_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_DIR="${2:-}"; shift 2 ;;
    --profile) PROFILE_CODE="${2:-}"; shift 2 ;;
    --apk) APK_PATH="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "--profile must be a canonical uppercase dynamic profile code" >&2
  exit 2
fi
if [[ ! -d "$PROJECT_DIR" || ! -f "$APK_PATH" ]]; then
  echo "--project must be a directory and --apk must be an existing file" >&2
  exit 2
fi

PROFILE_FILE="$PROJECT_DIR/android-djx-runtime/profiles/$PROFILE_CODE.json"
TAKU_BUNDLE_LOCK="$PROJECT_DIR/android-djx-runtime/taku-adapter-bundle.lock.json"
TAKU_BUNDLE_VERIFIER="$PROJECT_DIR/android-djx-runtime/verify-taku-adapter-bundle.mjs"
TAKU_BUNDLE_DIR="$PROJECT_DIR/android-djx-runtime/app/libs/taku"
TAKU_KEEP_FILE="$PROJECT_DIR/android-djx-runtime/app/src/main/res/raw/keep.xml"
for required_file in \
  "$PROFILE_FILE" \
  "$TAKU_BUNDLE_LOCK" \
  "$TAKU_BUNDLE_VERIFIER" \
  "$TAKU_KEEP_FILE"; do
  if [[ ! -f "$required_file" ]]; then
    echo "FAIL missing controlled package input: $required_file" >&2
    exit 1
  fi
done
if [[ ! -d "$TAKU_BUNDLE_DIR" ]]; then
  echo "FAIL missing locked Taku bundle directory: $TAKU_BUNDLE_DIR" >&2
  exit 1
fi

TASK_ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$TASK_ANDROID_SDK" ]]; then
  echo "ANDROID_HOME or ANDROID_SDK_ROOT is required" >&2
  exit 2
fi
AAPT_BIN="${AAPT_BIN:-}"
APK_ANALYZER_BIN="${APK_ANALYZER_BIN:-$TASK_ANDROID_SDK/cmdline-tools/latest/bin/apkanalyzer}"
if [[ -z "$AAPT_BIN" ]]; then
  AAPT_BIN="$(find "$TASK_ANDROID_SDK/build-tools" -type f -name aapt -perm -111 2>/dev/null | sort -V | tail -1 || true)"
fi
for tool in "$AAPT_BIN" "$APK_ANALYZER_BIN" unzip node shasum; do
  if [[ "$tool" == */* ]]; then
    [[ -x "$tool" ]] || { echo "Missing executable: $tool" >&2; exit 2; }
  else
    command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 2; }
  fi
done

profile_value() {
  node - "$PROFILE_FILE" "$1" <<'NODE'
const fs = require('fs');
const [profilePath, dottedPath] = process.argv.slice(2);
let value = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
for (const part of dottedPath.split('.')) value = value?.[part];
if (value === undefined || value === null || value === '') process.exit(2);
process.stdout.write(String(value));
NODE
}

lock_value() {
  node - "$TAKU_BUNDLE_LOCK" "$1" <<'NODE'
const fs = require('fs');
const [lockPath, dottedPath] = process.argv.slice(2);
let value = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
for (const part of dottedPath.split('.')) value = value?.[part];
if (value === undefined || value === null || value === '') process.exit(2);
process.stdout.write(String(value));
NODE
}

expect_equal() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL $label does not match dynamic profile $PROFILE_CODE" >&2
    exit 1
  fi
}

expect_asset() {
  local asset="$1"
  if ! unzip -Z1 "$APK_PATH" | grep -Fx "$asset" >/dev/null; then
    echo "FAIL missing APK asset: $asset" >&2
    exit 1
  fi
}

APPLICATION_ID="$(profile_value applicationId)"
TENANT_ID="$(profile_value tenantId)"
PANGLE_APP_ID="$(profile_value pangle.siteId)"
TAKU_APP_ID="$(profile_value taku.appId)"
TAKU_PLACEMENT_ID="$(profile_value taku.rewardPlacementId)"
TAKU_SDK_VERSION="$(profile_value taku.sdkVersion)"
PANGLE_AD_SDK_VERSION="$(profile_value pangle.adSdkVersion)"
PROFILE_PANGLE_SOURCE="$PROJECT_DIR/$(profile_value pangle.settingsSource)"
PANGLE_SOURCE="${SKIT_PANGLE_SETTINGS_JSON:-$PROFILE_PANGLE_SOURCE}"

expect_equal taku-sdk-version "$TAKU_SDK_VERSION" "$(lock_value sdkVersions.takuCore)"
expect_equal pangle-sdk-version "$PANGLE_AD_SDK_VERSION" "$(lock_value sdkVersions.pangleGroMore)"

node "$TAKU_BUNDLE_VERIFIER" \
  --mode source \
  --manifest "$TAKU_BUNDLE_LOCK" \
  --bundle-dir "$TAKU_BUNDLE_DIR" \
  --keep-file "$TAKU_KEEP_FILE"
node "$TAKU_BUNDLE_VERIFIER" \
  --mode apk \
  --manifest "$TAKU_BUNDLE_LOCK" \
  --apk "$APK_PATH" \
  --aapt "$AAPT_BIN"

PACKAGE_ID="$("$AAPT_BIN" dump badging "$APK_PATH" | sed -n -E "s/^package: name='([^']+)'.*/\1/p" | head -1)"
expect_equal package "$PACKAGE_ID" "$APPLICATION_ID"

TASK_TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TASK_TMP_DIR"; }
trap cleanup EXIT
BUILD_CONFIG="$TASK_TMP_DIR/BuildConfig.smali"
"$APK_ANALYZER_BIN" dex code --class "$APPLICATION_ID.BuildConfig" "$APK_PATH" > "$BUILD_CONFIG"

build_config_value() {
  local field="$1"
  sed -n -E "/\.field public static final ${field}:Ljava\/lang\/String;/s/.*= \"([^\"]*)\"/\1/p" "$BUILD_CONFIG" | head -1
}

expect_equal tenant "$(build_config_value TENANT_ID)" "$TENANT_ID"
expect_equal pangle-app-id "$(build_config_value PANGLE_APP_ID)" "$PANGLE_APP_ID"
expect_equal taku-app-id "$(build_config_value TAKU_APP_ID)" "$TAKU_APP_ID"
expect_equal taku-placement "$(build_config_value TAKU_REWARD_PLACEMENT_ID)" "$TAKU_PLACEMENT_ID"

API_BASE_URL="$(build_config_value API_BASE_URL)"
if [[ ! "$API_BASE_URL" =~ ^https:// ]]; then
  echo "FAIL APK uses a non-HTTPS API base URL" >&2
  exit 1
fi
TAKU_APP_KEY="$(build_config_value TAKU_APP_KEY)"
if [[ ${#TAKU_APP_KEY} -lt 16 ]]; then
  echo "FAIL APK has no usable Taku AppKey" >&2
  exit 1
fi
unset TAKU_APP_KEY

expect_asset assets/SDK_Setting.json
expect_asset assets/www/djx-runtime.js
LOGIN_ASSET="$(unzip -Z1 "$APK_PATH" | grep -E '^assets/www/assets/pages-auth-index[^/]*\.js$' | head -1 || true)"
if [[ -z "$LOGIN_ASSET" ]] || ! unzip -p "$APK_PATH" "$LOGIN_ASSET" | grep -F "\"$PROFILE_CODE\"" >/dev/null; then
  echo "FAIL H5 login bundle is not bound to dynamic profile $PROFILE_CODE" >&2
  exit 1
fi
H5_API_FOUND=0
while IFS= read -r asset; do
  [[ -z "$asset" ]] && continue
  if unzip -p "$APK_PATH" "$asset" | grep -F "$API_BASE_URL" >/dev/null; then
    H5_API_FOUND=1
  fi
done < <(unzip -Z1 "$APK_PATH" | grep -E '^assets/www/assets/[^/]+\.js$' || true)
if [[ "$H5_API_FOUND" != 1 ]]; then
  echo "FAIL H5 login bundle API base differs from native runtime" >&2
  exit 1
fi

if [[ ! -f "$PANGLE_SOURCE" ]]; then
  echo "FAIL profile Pangle settings source is missing" >&2
  exit 1
fi
SOURCE_HASH="$(shasum -a 256 "$PANGLE_SOURCE" | awk '{print $1}')"
APK_HASH="$(unzip -p "$APK_PATH" assets/SDK_Setting.json | shasum -a 256 | awk '{print $1}')"
expect_equal pangle-settings "$APK_HASH" "$SOURCE_HASH"

echo "PASS profile=$PROFILE_CODE package=$APPLICATION_ID"
echo "PASS locked Taku multi-network bundle and profile SDK versions"
echo "PASS H5/native profile bindings, Pangle settings, HTTPS API, and Taku AppKey"
