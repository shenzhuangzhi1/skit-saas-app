#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/android-djx-runtime"
TAKU_BUNDLE_LOCK="$RUNTIME_DIR/taku-adapter-bundle.lock.json"
TAKU_BUNDLE_VERIFIER="$RUNTIME_DIR/verify-taku-adapter-bundle.mjs"
PROFILE_CODE="${SKIT_PROFILE_CODE:-${SKIT_AGENT_CODE:-}}"
if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "Production APK verification failed: SKIT_PROFILE_CODE is missing or invalid" >&2
  exit 1
fi
PROFILE_FILE="$RUNTIME_DIR/profiles/$PROFILE_CODE.json"
if [[ -n "${SKIT_PRODUCTION_PROFILE:-}" && "$SKIT_PRODUCTION_PROFILE" != "$PROFILE_FILE" ]]; then
  echo "Production APK verification failed: SKIT_PRODUCTION_PROFILE is not controlled" >&2
  exit 1
fi
node "$RUNTIME_DIR/resolve-build-profile.mjs" \
  --profile-code "$PROFILE_CODE" \
  --profiles-dir "$RUNTIME_DIR/profiles" >/dev/null
APK_FILE_OVERRIDE="${APK_FILE:-${1:-}}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ALLOW_DEBUG_RUNTIME_DEFAULTS="${SKIT_ALLOW_DEBUG_RUNTIME_DEFAULTS:-0}"

fail() {
  echo "Production APK verification failed: $*" >&2
  exit 1
}

node "$TAKU_BUNDLE_VERIFIER" \
  --mode source \
  --manifest "$TAKU_BUNDLE_LOCK" \
  --bundle-dir "$RUNTIME_DIR/app/libs/taku" \
  --keep-file "$RUNTIME_DIR/app/src/main/res/raw/keep.xml" || \
  fail "locked Taku source bundle verification failed"

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

PROFILE_ID="$(profile_value profileId)"
PROFILE_CODE_VALUE="$(profile_value profileCode)"
EXPECTED_OUTPUT_BASE_NAME="$(profile_value outputBaseName)"
APK_FILE="${APK_FILE_OVERRIDE:-$ROOT_DIR/dist/${EXPECTED_OUTPUT_BASE_NAME}-debug.apk}"
[[ -f "$APK_FILE" ]] || fail "missing APK $APK_FILE"
EXPECTED_PACKAGE="$(profile_value applicationId)"
EXPECTED_ASSET="$(profile_value pangle.settingsAsset)"
EXPECTED_SITE_ID="$(profile_value pangle.siteId)"
EXPECTED_CONTENT_APP_ID="$(profile_value pangle.contentAppId)"
EXPECTED_PANGLE_AD_SDK_VERSION="$(profile_value pangle.adSdkVersion)"
EXPECTED_PANGLE_CONTENT_SDK_VERSION="$(profile_value pangle.contentSdkVersion)"
EXPECTED_TAKU_APP_ID="$(profile_value taku.appId)"
EXPECTED_TAKU_PLACEMENT_ID="$(profile_value taku.rewardPlacementId)"
EXPECTED_TAKU_SDK_VERSION="$(profile_value taku.sdkVersion)"
EXPECTED_TENANT_ID="${SKIT_TENANT_ID:-debug-local}"
EXPECTED_RUNTIME_PUBLIC_KEY="${SKIT_RUNTIME_UPDATE_PUBLIC_KEY:-}"
EXPECTED_RUNTIME_PROTOCOL="${SKIT_RUNTIME_PROTOCOL_VERSION:-1}"
EXPECTED_RUNTIME_RELEASE="${SKIT_RUNTIME_RELEASE_NO:-0}"
EXPECTED_VERSION_CODE="${SKIT_VERSION_CODE:-3}"
EXPECTED_VERSION_NAME="${SKIT_VERSION_NAME:-2026.07.10-djx}"
EXPECTED_RELEASE_CERT_SHA256="$(
  printf '%s' "${SKIT_RELEASE_CERT_SHA256:-}" | tr -d ':' | tr '[:upper:]' '[:lower:]'
)"

[[ "$PROFILE_CODE_VALUE" == "$PROFILE_CODE" ]] || fail "profileCode does not match SKIT_PROFILE_CODE"

if [[ "$ALLOW_DEBUG_RUNTIME_DEFAULTS" == "1" ]]; then
  [[ "$EXPECTED_TENANT_ID" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || \
    fail "debug tenant identity is invalid"
  if [[ -n "$EXPECTED_RUNTIME_PUBLIC_KEY" ]]; then
    (( ${#EXPECTED_RUNTIME_PUBLIC_KEY} >= 128 && ${#EXPECTED_RUNTIME_PUBLIC_KEY} <= 2048 )) || \
      fail "debug runtime update public key is invalid"
    [[ "$EXPECTED_RUNTIME_PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]+$ ]] || \
      fail "debug runtime update public key is invalid"
  fi
  [[ "$EXPECTED_RUNTIME_PROTOCOL" =~ ^[1-9][0-9]*$ ]] || \
    fail "debug runtime protocol is invalid"
  [[ "$EXPECTED_RUNTIME_RELEASE" =~ ^[0-9]+$ ]] || \
    fail "debug runtime release is invalid"
else
  [[ "$EXPECTED_TENANT_ID" =~ ^[A-Z0-9_-]{3,32}$ ]] || \
    fail "SKIT_TENANT_ID is missing or invalid"
  (( ${#EXPECTED_RUNTIME_PUBLIC_KEY} >= 128 && ${#EXPECTED_RUNTIME_PUBLIC_KEY} <= 2048 )) || \
    fail "SKIT_RUNTIME_UPDATE_PUBLIC_KEY is missing or invalid"
  [[ "$EXPECTED_RUNTIME_PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]+$ ]] || \
    fail "SKIT_RUNTIME_UPDATE_PUBLIC_KEY is missing or invalid"
  [[ "$EXPECTED_RUNTIME_PROTOCOL" =~ ^[1-9][0-9]*$ ]] || \
    fail "SKIT_RUNTIME_PROTOCOL_VERSION is missing or invalid"
  [[ "$EXPECTED_RUNTIME_RELEASE" =~ ^[1-9][0-9]*$ ]] || \
    fail "SKIT_RUNTIME_RELEASE_NO is missing or invalid"
  [[ "$EXPECTED_RELEASE_CERT_SHA256" =~ ^[a-f0-9]{64}$ ]] || \
    fail "SKIT_RELEASE_CERT_SHA256 is missing or invalid"
fi
[[ "$EXPECTED_VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] || \
  fail "SKIT_VERSION_CODE is missing or invalid"
(( EXPECTED_VERSION_CODE <= 2100000000 )) || fail "SKIT_VERSION_CODE is too large"
[[ "$EXPECTED_VERSION_NAME" =~ ^[0-9]+(\.[0-9]+){1,3}([.-][A-Za-z0-9._-]+)?$ ]] || \
  fail "SKIT_VERSION_NAME is missing or invalid"

if [[ -n "$EXPECTED_RUNTIME_PUBLIC_KEY" ]]; then
  PUBLIC_KEY_BITS="$(
    printf '%s' "$EXPECTED_RUNTIME_PUBLIC_KEY" | \
      python3 -c 'import base64,sys; sys.stdout.buffer.write(base64.b64decode(sys.stdin.buffer.read(), validate=True))' | \
      openssl pkey -pubin -inform DER -text -noout 2>/dev/null | \
      sed -n 's/^Public-Key: (\([0-9][0-9]*\) bit)$/\1/p' || true
  )"
  [[ "$PUBLIC_KEY_BITS" =~ ^[0-9]+$ ]] || fail "runtime update public key is invalid"
  (( PUBLIC_KEY_BITS >= 2048 )) || fail "runtime update public key is weaker than 2048 bits"
fi

AAPT="${AAPT:-}"
if [[ -z "$AAPT" ]]; then
  AAPT="$(find "$ANDROID_HOME/build-tools" -type f -name aapt 2>/dev/null | sort -V | tail -1)"
fi
[[ -x "$AAPT" ]] || fail "aapt not found under $ANDROID_HOME/build-tools"

APKSIGNER="${APKSIGNER:-}"
if [[ -z "$APKSIGNER" ]]; then
  APKSIGNER="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner 2>/dev/null | sort -V | tail -1)"
fi
[[ -x "$APKSIGNER" ]] || fail "apksigner not found under $ANDROID_HOME/build-tools"

APKANALYZER="${APKANALYZER:-}"
if [[ -z "$APKANALYZER" ]]; then
  APKANALYZER="$(find "$ANDROID_HOME/cmdline-tools" -type f -name apkanalyzer 2>/dev/null | sort -V | tail -1)"
fi
[[ -x "$APKANALYZER" ]] || fail "apkanalyzer not found under $ANDROID_HOME/cmdline-tools"

node "$TAKU_BUNDLE_VERIFIER" \
  --mode apk \
  --manifest "$TAKU_BUNDLE_LOCK" \
  --apk "$APK_FILE" \
  --aapt "$AAPT" || fail "locked Taku APK bundle verification failed"

ACTUAL_PACKAGE="$($AAPT dump badging "$APK_FILE" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
[[ "$ACTUAL_PACKAGE" == "$EXPECTED_PACKAGE" ]] || \
  fail "package is $ACTUAL_PACKAGE, expected $EXPECTED_PACKAGE"
ACTUAL_VERSION_CODE="$($AAPT dump badging "$APK_FILE" | sed -n "s/^package: .*versionCode='\([^']*\)'.*/\1/p" | head -1)"
ACTUAL_VERSION_NAME="$($AAPT dump badging "$APK_FILE" | sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p" | head -1)"
[[ "$ACTUAL_VERSION_CODE" == "$EXPECTED_VERSION_CODE" ]] || \
  fail "versionCode is $ACTUAL_VERSION_CODE, expected $EXPECTED_VERSION_CODE"
[[ "$ACTUAL_VERSION_NAME" == "$EXPECTED_VERSION_NAME" ]] || \
  fail "versionName is $ACTUAL_VERSION_NAME, expected $EXPECTED_VERSION_NAME"

if [[ "$ALLOW_DEBUG_RUNTIME_DEFAULTS" != "1" ]]; then
  MANIFEST_TREE="$($AAPT dump xmltree "$APK_FILE" AndroidManifest.xml)"
  if [[ "$MANIFEST_TREE" =~ android:debuggable.*0xffffffff ]]; then
    fail "production APK is debuggable"
  fi
  [[ "$MANIFEST_TREE" =~ android:usesCleartextTraffic.*0x0 ]] || \
    fail "production APK must deny cleartext traffic by default"
  [[ "$MANIFEST_TREE" =~ android:networkSecurityConfig ]] || \
    fail "production APK is missing the loopback network security config"

  NETWORK_SECURITY_FILE="$($APKANALYZER resources value \
    --config default \
    --type xml \
    --name network_security_config \
    "$APK_FILE" 2>/dev/null || true)"
  [[ "$NETWORK_SECURITY_FILE" =~ ^res/.+\.xml$ ]] || \
    fail "production APK network security resource is unreadable"
  NETWORK_SECURITY_XML="$($APKANALYZER resources xml \
    --file "$NETWORK_SECURITY_FILE" \
    "$APK_FILE" 2>/dev/null || true)"
  printf '%s' "$NETWORK_SECURITY_XML" | python3 -c '
import sys
import xml.etree.ElementTree as ET

root = ET.fromstring(sys.stdin.read())
bases = list(root.iter("base-config"))
domain_configs = list(root.iter("domain-config"))
domains = list(root.iter("domain"))
valid = (
    root.tag == "network-security-config"
    and len(bases) == 1
    and bases[0].get("cleartextTrafficPermitted") == "false"
    and len(domain_configs) == 1
    and domain_configs[0].get("cleartextTrafficPermitted") == "true"
    and len(domains) == 1
    and domains[0].get("includeSubdomains") == "false"
    and (domains[0].text or "").strip() == "127.0.0.1"
)
raise SystemExit(0 if valid else 1)
' || fail "network security config must deny cleartext except exact loopback"

  SIGNATURE_INFO=""
  if ! SIGNATURE_INFO="$($APKSIGNER verify --print-certs "$APK_FILE" 2>/dev/null)"; then
    fail "APK signature verification failed"
  fi
  CERT_DIGESTS="$(
    printf '%s\n' "$SIGNATURE_INFO" | \
      sed -n \
        -e 's/^Signer #[0-9][0-9]* certificate SHA-256 digest: //p' \
        -e 's/^V[0-9][0-9.]* Signer: certificate SHA-256 digest: //p' | \
      tr '[:upper:]' '[:lower:]' | \
      sort -u
  )"
  CERT_COUNT="$(printf '%s\n' "$CERT_DIGESTS" | sed '/^$/d' | wc -l | tr -d ' ')"
  [[ "$CERT_COUNT" -eq 1 ]] || fail "APK must have exactly one release signer"
  [[ "$CERT_DIGESTS" == "$EXPECTED_RELEASE_CERT_SHA256" ]] || \
    fail "APK release certificate does not match SKIT_RELEASE_CERT_SHA256"
fi

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

FRONTEND_JS_BUNDLE="$TMP_DIR/frontend-js.txt"
: > "$FRONTEND_JS_BUNDLE"
while IFS= read -r js_file; do
  unzip -p "$APK_FILE" "$js_file" >> "$FRONTEND_JS_BUNDLE" || \
    fail "frontend asset $js_file is unreadable"
done < <(printf '%s\n' "$APK_ENTRIES" | grep -E '^assets/www/assets/.*\.js$' || true)
FRONTEND_REFS="$(
  grep -aoE 'SDK_Setting(_[0-9]+)?\.json' "$FRONTEND_JS_BUNDLE" | sort -u || true
)"
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
grep -Fq "$EXPECTED_TENANT_ID" "$DEX_STRINGS" || fail "tenant identity missing from runtime"
if [[ -n "$EXPECTED_RUNTIME_PUBLIC_KEY" ]]; then
  grep -Fq "$EXPECTED_RUNTIME_PUBLIC_KEY" "$DEX_STRINGS" || \
    fail "runtime update public key missing from runtime"
fi
grep -Fq 'SHA256withRSA' "$DEX_STRINGS" || fail "runtime manifest signature verifier missing"
grep -Fq 'highestAcceptedRelease' "$DEX_STRINGS" || fail "runtime anti-rollback state missing"
grep -Fq "skit-runtime-protocol-v$EXPECTED_RUNTIME_PROTOCOL" "$DEX_STRINGS" || \
  fail "runtime protocol metadata missing"
grep -Fq "skit-runtime-release-$EXPECTED_RUNTIME_RELEASE" "$DEX_STRINGS" || \
  fail "runtime release metadata missing"

if grep -Eq \
  'skit-local-unlock|onRewardVerify[[:space:]]*\([[:space:]]*true|unlocked\.add' \
  "$FRONTEND_JS_BUNDLE"; then
  fail "frontend bundle contains a local reward fallback"
fi

SHA256="$(shasum -a 256 "$APK_FILE" | awk '{print $1}')"
if [[ "$ALLOW_DEBUG_RUNTIME_DEFAULTS" == "1" ]]; then
  echo "Debug APK verified"
else
  echo "Production APK verified"
fi
echo "profile=$PROFILE_ID"
echo "package=$EXPECTED_PACKAGE"
echo "pangle_site=$EXPECTED_SITE_ID content_app=$EXPECTED_CONTENT_APP_ID asset=$EXPECTED_ASSET ad_sdk=$EXPECTED_PANGLE_AD_SDK_VERSION content_sdk=$EXPECTED_PANGLE_CONTENT_SDK_VERSION"
echo "taku_app=$EXPECTED_TAKU_APP_ID placement=$EXPECTED_TAKU_PLACEMENT_ID sdk=$EXPECTED_TAKU_SDK_VERSION"
echo "tenant=$EXPECTED_TENANT_ID runtime_protocol=$EXPECTED_RUNTIME_PROTOCOL runtime_release=$EXPECTED_RUNTIME_RELEASE"
echo "version_code=$EXPECTED_VERSION_CODE version_name=$EXPECTED_VERSION_NAME"
echo "sha256=$SHA256"
