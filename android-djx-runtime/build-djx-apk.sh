#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/android-djx-runtime"
APP_DIR="$RUNTIME_DIR/app"
DEFAULT_H5_DIR="$ROOT_DIR/unpackage/dist/build/h5-android-runtime"
H5_DIR="${H5_DIR:-$DEFAULT_H5_DIR}"
GRADLE_VERSION="${GRADLE_VERSION:-8.10.2}"
GRADLE_DIR="$RUNTIME_DIR/.gradle-dist/gradle-$GRADLE_VERSION"
GRADLE_ZIP="$RUNTIME_DIR/.gradle-dist/gradle-$GRADLE_VERSION-bin.zip"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME ANDROID_HOME

PROFILE_FILE="${SKIT_PRODUCTION_PROFILE:-$RUNTIME_DIR/production-profile.json}"
if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "Missing production profile: $PROFILE_FILE" >&2
  exit 1
fi

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

assert_profile_override() {
  local name="$1"
  local expected="$2"
  if [[ -n "${!name:-}" && "${!name}" != "$expected" ]]; then
    echo "$name=${!name} conflicts with production profile value $expected" >&2
    exit 1
  fi
}

AGENT_CODE="${SKIT_AGENT_CODE:-}"
PROFILE_ID="$(profile_value profileId)"
AD_PROVIDER="$(profile_value adProvider)"
PANGLE_APP_ID="$(profile_value pangle.siteId)"
PANGLE_CONTENT_APP_ID="$(profile_value pangle.contentAppId)"
PANGLE_SETTING_ASSET="$(profile_value pangle.settingsAsset)"
PANGLE_SETTINGS_RELATIVE="$(profile_value pangle.settingsSource)"
PANGLE_SETTINGS_SOURCE="${SKIT_PANGLE_SETTINGS_JSON:-$ROOT_DIR/$PANGLE_SETTINGS_RELATIVE}"
APPLICATION_ID="$(profile_value applicationId)"
APP_NAME="$(profile_value appName)"
TAKU_APP_ID="$(profile_value taku.appId)"
TAKU_APP_KEY="${SKIT_TAKU_APP_KEY:-}"
TAKU_PLACEMENT_ID="$(profile_value taku.rewardPlacementId)"
OUTPUT_BASE_NAME="$(profile_value outputBaseName)"
BUILD_TYPE="${SKIT_BUILD_TYPE:-debug}"

assert_profile_override SKIT_DRAMA_AD_PROVIDER "$AD_PROVIDER"
assert_profile_override SKIT_PANGLE_APP_ID "$PANGLE_APP_ID"
assert_profile_override SKIT_APPLICATION_ID "$APPLICATION_ID"
assert_profile_override SKIT_APP_NAME "$APP_NAME"
assert_profile_override SKIT_TAKU_APP_ID "$TAKU_APP_ID"
assert_profile_override SKIT_TAKU_REWARD_PLACEMENT_ID "$TAKU_PLACEMENT_ID"

if [[ "$BUILD_TYPE" != "debug" && "$BUILD_TYPE" != "release" ]]; then
  echo "SKIT_BUILD_TYPE must be debug or release" >&2
  exit 1
fi
if [[ "$AD_PROVIDER" != "pangle" && "$AD_PROVIDER" != "taku" ]]; then
  echo "SKIT_DRAMA_AD_PROVIDER must be pangle or taku" >&2
  exit 1
fi
if [[ "$AD_PROVIDER" == "taku" && -z "$TAKU_APP_KEY" ]]; then
  echo "Taku builds require SKIT_TAKU_APP_KEY" >&2
  exit 1
fi
if [[ -z "${SKIT_API_BASE_URL:-}" ]]; then
  echo "Android builds require SKIT_API_BASE_URL; use a reachable dev URL for debug or HTTPS for release" >&2
  exit 1
fi
if [[ "$BUILD_TYPE" == "release" && ! "$SKIT_API_BASE_URL" =~ ^https:// ]]; then
  echo "Release Android builds require SKIT_API_BASE_URL with HTTPS" >&2
  exit 1
fi
export SHOPRO_BASE_URL="$SKIT_API_BASE_URL"
export SHOPRO_TRIAL_BASE_URL="$SKIT_API_BASE_URL"

if [[ "$BUILD_TYPE" == "release" ]]; then
  for signing_name in \
    SKIT_RELEASE_STORE_FILE \
    SKIT_RELEASE_STORE_PASSWORD \
    SKIT_RELEASE_KEY_ALIAS \
    SKIT_RELEASE_KEY_PASSWORD; do
    if [[ -z "${!signing_name:-}" ]]; then
      echo "Missing release signing setting: $signing_name" >&2
      exit 1
    fi
  done
fi

if [[ -n "$AGENT_CODE" ]]; then
  for required_name in \
    SKIT_APPLICATION_ID \
    SKIT_PANGLE_APP_ID \
    SKIT_PANGLE_SETTINGS_JSON \
    SKIT_TAKU_APP_ID \
    SKIT_TAKU_APP_KEY \
    SKIT_TAKU_REWARD_PLACEMENT_ID \
    SKIT_API_BASE_URL; do
    if [[ -z "${!required_name:-}" ]]; then
      echo "Missing required white-label setting: $required_name" >&2
      exit 1
    fi
  done
  if [[ ! "$SKIT_API_BASE_URL" =~ ^https:// ]]; then
    echo "SKIT_API_BASE_URL must use HTTPS for an agent build" >&2
    exit 1
  fi
  if [[ ! "$AGENT_CODE" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "SKIT_AGENT_CODE may only contain letters, numbers, dot, underscore, or dash" >&2
    exit 1
  fi
fi
export SKIT_APPLICATION_ID="$APPLICATION_ID"
export SKIT_APP_NAME="$APP_NAME"
export SKIT_PANGLE_APP_ID="$PANGLE_APP_ID"
export SKIT_TAKU_APP_ID="$TAKU_APP_ID"
export SKIT_TAKU_REWARD_PLACEMENT_ID="$TAKU_PLACEMENT_ID"
export VITE_PANGLE_DRAMA_SETTING_FILE="$PANGLE_SETTING_ASSET"
export VITE_DRAMA_AD_PROVIDER="$AD_PROVIDER"
export VITE_DRAMA_MOCK_REWARD_AD="false"
export VITE_DRAMA_REAL_CONTENT_REQUIRED="true"
export VITE_PANGLE_APP_ID="$PANGLE_APP_ID"
export VITE_TAKU_APP_ID="$TAKU_APP_ID"
export VITE_TAKU_REWARD_PLACEMENT_ID="$TAKU_PLACEMENT_ID"
export VITE_SKIT_AGENT_CODE="$AGENT_CODE"

if [[ ! -f "$PANGLE_SETTINGS_SOURCE" ]]; then
  echo "Missing Pangle SDK settings file: $PANGLE_SETTINGS_SOURCE" >&2
  exit 1
fi

python3 - "$PANGLE_SETTINGS_SOURCE" "$PANGLE_APP_ID" "$PANGLE_CONTENT_APP_ID" "$APPLICATION_ID" <<'PY'
import json
import sys

path, expected_site_id, expected_content_app_id, expected_package = sys.argv[1:]
with open(path, "r", encoding="utf-8") as source:
    profile = json.load(source)
site_id = str(profile.get("init", {}).get("site_id", ""))
content_app_id = str(profile.get("init", {}).get("app_id", ""))
licenses = profile.get("license_config") or []
packages = {str(item.get("PackageName", "")) for item in licenses}
if site_id != expected_site_id:
    raise SystemExit(f"Pangle site_id mismatch: expected {expected_site_id}, got {site_id}")
if content_app_id != expected_content_app_id:
    raise SystemExit(
        f"Pangle content app_id mismatch: expected {expected_content_app_id}, got {content_app_id}"
    )
if expected_package not in packages:
    raise SystemExit(f"Pangle license does not include package {expected_package}")
PY

if [[ "$BUILD_TYPE" == "release" && "${SKIP_UNI_BUILD:-0}" == "1" ]]; then
  echo "Release builds cannot use SKIP_UNI_BUILD=1" >&2
  exit 1
fi

if [[ "$H5_DIR" == "$DEFAULT_H5_DIR" && "${SKIP_UNI_BUILD:-0}" != "1" ]]; then
  H5_DIR="$H5_DIR" "$RUNTIME_DIR/build-h5.sh"
fi

if [[ ! -d "$H5_DIR" ]]; then
  echo "Missing H5 build directory: $H5_DIR" >&2
  exit 1
fi

mkdir -p "$APP_DIR/src/main/assets/www" "$APP_DIR/src/main/assets" "$RUNTIME_DIR/.gradle-dist"
rm -rf "$APP_DIR/src/main/assets/www"
mkdir -p "$APP_DIR/src/main/assets/www"
cp -R "$H5_DIR"/. "$APP_DIR/src/main/assets/www/"
cp "$RUNTIME_DIR/djx-runtime.js" "$APP_DIR/src/main/assets/www/djx-runtime.js"
if ! grep -q 'djx-runtime.js' "$APP_DIR/src/main/assets/www/index.html"; then
  perl -0pi -e 's#</body>#  <script src="./djx-runtime.js"></script>\n  </body>#' "$APP_DIR/src/main/assets/www/index.html"
fi
find "$APP_DIR/src/main/assets" -maxdepth 1 -type f -name 'SDK_Setting*.json' -delete
cp "$PANGLE_SETTINGS_SOURCE" "$APP_DIR/src/main/assets/$PANGLE_SETTING_ASSET"

if [[ ! -x "$GRADLE_DIR/bin/gradle" ]]; then
  if [[ ! -f "$GRADLE_ZIP" ]]; then
    curl -fL -o "$GRADLE_ZIP" "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  fi
  rm -rf "$GRADLE_DIR"
  unzip -q "$GRADLE_ZIP" -d "$RUNTIME_DIR/.gradle-dist"
fi

if [[ ! -f "$RUNTIME_DIR/debug.keystore" ]]; then
  keytool -genkeypair \
    -keystore "$RUNTIME_DIR/debug.keystore" \
    -storepass android \
    -keypass android \
    -alias androiddebugkey \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Skit,C=CN" >/dev/null
fi

cd "$RUNTIME_DIR"
if [[ "$BUILD_TYPE" == "release" ]]; then
  "$GRADLE_DIR/bin/gradle" --no-daemon :app:clean :app:assembleRelease
  SOURCE_APK="$APP_DIR/build/outputs/apk/release/app-release.apk"
else
  "$GRADLE_DIR/bin/gradle" --no-daemon :app:clean :app:assembleDebug
  SOURCE_APK="$APP_DIR/build/outputs/apk/debug/app-debug.apk"
fi
mkdir -p "$ROOT_DIR/dist"
OUTPUT_NAME="$OUTPUT_BASE_NAME-$BUILD_TYPE.apk"
cp "$SOURCE_APK" "$ROOT_DIR/dist/$OUTPUT_NAME"

APK_FILE="$ROOT_DIR/dist/$OUTPUT_NAME" \
  SKIT_PRODUCTION_PROFILE="$PROFILE_FILE" \
  "$RUNTIME_DIR/verify-production-apk.sh"
echo "profile=$PROFILE_ID"
echo "$ROOT_DIR/dist/$OUTPUT_NAME"
