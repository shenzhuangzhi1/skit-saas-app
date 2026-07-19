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

PROFILE_CODE="${SKIT_PROFILE_CODE:-${SKIT_AGENT_CODE:-}}"
if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "SKIT_PROFILE_CODE must be the canonical uppercase release profile code" >&2
  exit 1
fi
PROFILE_FILE="$RUNTIME_DIR/profiles/$PROFILE_CODE.json"
if [[ -n "${SKIT_PRODUCTION_PROFILE:-}" && "$SKIT_PRODUCTION_PROFILE" != "$PROFILE_FILE" ]]; then
  echo "SKIT_PRODUCTION_PROFILE must be the controlled profile $PROFILE_FILE" >&2
  exit 1
fi
node "$RUNTIME_DIR/resolve-build-profile.mjs" \
  --profile-code "$PROFILE_CODE" \
  --profiles-dir "$RUNTIME_DIR/profiles"
export SKIT_PROFILE_CODE="$PROFILE_CODE"
export SKIT_PRODUCTION_PROFILE="$PROFILE_FILE"

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

AGENT_CODE="${SKIT_AGENT_CODE:-$PROFILE_CODE}"
PROFILE_CODE_VALUE="$(profile_value profileCode)"
PROFILE_VERSION="$(profile_value profileVersion)"
PROFILE_TENANT_ID="$(profile_value tenantId)"
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

if [[ "$PROFILE_CODE_VALUE" != "$PROFILE_CODE" ]]; then
  echo "Profile profileCode must equal SKIT_PROFILE_CODE" >&2
  exit 1
fi
if [[ "$AGENT_CODE" != "$PROFILE_CODE" ]]; then
  echo "SKIT_AGENT_CODE must equal SKIT_PROFILE_CODE" >&2
  exit 1
fi
if [[ -n "${SKIT_TENANT_ID:-}" && "$SKIT_TENANT_ID" != "$PROFILE_TENANT_ID" ]]; then
  echo "SKIT_TENANT_ID must equal SKIT_AGENT_CODE" >&2
  exit 1
fi
export SKIT_AGENT_CODE="$AGENT_CODE"
export SKIT_TENANT_ID="$PROFILE_TENANT_ID"

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
    SKIT_RELEASE_KEY_PASSWORD \
    SKIT_RELEASE_CERT_SHA256; do
    if [[ -z "${!signing_name:-}" ]]; then
      echo "Missing release signing setting: $signing_name" >&2
      exit 1
    fi
  done
  if [[ ! "$SKIT_RELEASE_CERT_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]]; then
    echo "SKIT_RELEASE_CERT_SHA256 must be the pinned release certificate SHA-256" >&2
    exit 1
  fi
  for runtime_name in \
    SKIT_TENANT_ID \
    SKIT_RUNTIME_UPDATE_PUBLIC_KEY \
    SKIT_RUNTIME_PROTOCOL_VERSION \
    SKIT_RUNTIME_RELEASE_NO \
    SKIT_VERSION_CODE \
    SKIT_VERSION_NAME; do
    if [[ -z "${!runtime_name:-}" ]]; then
      echo "Missing secure runtime update setting: $runtime_name" >&2
      exit 1
    fi
  done
  if [[ ! "$SKIT_TENANT_ID" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
    echo "SKIT_TENANT_ID has an invalid format" >&2
    exit 1
  fi
  if (( ${#SKIT_RUNTIME_UPDATE_PUBLIC_KEY} < 128 || ${#SKIT_RUNTIME_UPDATE_PUBLIC_KEY} > 2048 )) ||
     [[ ! "$SKIT_RUNTIME_UPDATE_PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]+$ ]]; then
    echo "SKIT_RUNTIME_UPDATE_PUBLIC_KEY must be an X.509 RSA public key in base64 DER" >&2
    exit 1
  fi
  PUBLIC_KEY_BITS="$(
    printf '%s' "$SKIT_RUNTIME_UPDATE_PUBLIC_KEY" | \
      python3 -c 'import base64,sys; sys.stdout.buffer.write(base64.b64decode(sys.stdin.buffer.read(), validate=True))' | \
      openssl pkey -pubin -inform DER -text -noout 2>/dev/null | \
      sed -n 's/^Public-Key: (\([0-9][0-9]*\) bit)$/\1/p' || true
  )"
  if [[ ! "$PUBLIC_KEY_BITS" =~ ^[0-9]+$ ]] || (( PUBLIC_KEY_BITS < 2048 )); then
    echo "SKIT_RUNTIME_UPDATE_PUBLIC_KEY must be an RSA key of at least 2048 bits" >&2
    exit 1
  fi
  if [[ ! "$SKIT_RUNTIME_PROTOCOL_VERSION" =~ ^[1-9][0-9]*$ ]]; then
    echo "SKIT_RUNTIME_PROTOCOL_VERSION must be a positive integer" >&2
    exit 1
  fi
  if [[ ! "$SKIT_RUNTIME_RELEASE_NO" =~ ^[1-9][0-9]*$ ]]; then
    echo "SKIT_RUNTIME_RELEASE_NO must be a positive integer" >&2
    exit 1
  fi
  if [[ ! "$SKIT_VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] \
      || (( SKIT_VERSION_CODE > 2100000000 )); then
    echo "SKIT_VERSION_CODE must be between 1 and 2100000000" >&2
    exit 1
  fi
  if [[ ! "$SKIT_VERSION_NAME" =~ ^[0-9]+(\.[0-9]+){1,3}([.-][A-Za-z0-9._-]+)?$ ]]; then
    echo "SKIT_VERSION_NAME must be a release version such as 2.3.0" >&2
    exit 1
  fi
fi

export SKIT_DRAMA_AD_PROVIDER="$AD_PROVIDER"
export SKIT_APPLICATION_ID="$APPLICATION_ID"
export SKIT_APP_NAME="$APP_NAME"
export SKIT_PANGLE_APP_ID="$PANGLE_APP_ID"
export SKIT_PANGLE_SETTINGS_JSON="$PANGLE_SETTINGS_SOURCE"
export SKIT_TAKU_APP_ID="$TAKU_APP_ID"
export SKIT_TAKU_REWARD_PLACEMENT_ID="$TAKU_PLACEMENT_ID"

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
  if [[ ! "$AGENT_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
    echo "SKIT_AGENT_CODE must be the canonical uppercase release profile code" >&2
    exit 1
  fi
  if [[ "${SKIT_TENANT_ID:-}" != "$AGENT_CODE" ]]; then
    echo "SKIT_TENANT_ID must equal SKIT_AGENT_CODE" >&2
    exit 1
  fi
fi
export SKIT_API_PATH="${SKIT_API_PATH:-/app-api}"
export VITE_PANGLE_DRAMA_SETTING_FILE="$PANGLE_SETTING_ASSET"
export VITE_DRAMA_AD_PROVIDER="$AD_PROVIDER"
# shellcheck source=production-h5-env.sh
. "$RUNTIME_DIR/production-h5-env.sh"
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

export SKIT_H5_DIR="$H5_DIR"
export SKIT_PANGLE_SETTINGS_JSON="$PANGLE_SETTINGS_SOURCE"
mkdir -p "$RUNTIME_DIR/.gradle-dist"

if [[ ! -x "$GRADLE_DIR/bin/gradle" ]]; then
  if [[ ! -f "$GRADLE_ZIP" ]]; then
    curl -fL -o "$GRADLE_ZIP" "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  fi
  rm -rf "$GRADLE_DIR"
  unzip -q "$GRADLE_ZIP" -d "$RUNTIME_DIR/.gradle-dist"
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

if [[ "$BUILD_TYPE" == "release" ]]; then
  APK_FILE="$ROOT_DIR/dist/$OUTPUT_NAME" \
    SKIT_PRODUCTION_PROFILE="$PROFILE_FILE" \
    "$RUNTIME_DIR/verify-production-apk.sh"
else
  APK_FILE="$ROOT_DIR/dist/$OUTPUT_NAME" \
    SKIT_PRODUCTION_PROFILE="$PROFILE_FILE" \
    SKIT_ALLOW_DEBUG_RUNTIME_DEFAULTS=1 \
    "$RUNTIME_DIR/verify-production-apk.sh"
fi
echo "profile=$PROFILE_ID"
echo "profile_code=$PROFILE_CODE profile_version=$PROFILE_VERSION"
echo "$ROOT_DIR/dist/$OUTPUT_NAME"
