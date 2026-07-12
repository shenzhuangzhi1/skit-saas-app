#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_FILE="${SKIT_PANGLE_SETTING_ASSET:-SDK_Setting.json}"
EXPECTED_PACKAGE="${SKIT_APPLICATION_ID:-top.neoshen.xingheyingguan}"
CANONICAL_FILE="${SKIT_PANGLE_SETTINGS_JSON:-$ROOT_DIR/nativeplugins/SkitPangleDrama/android/assets/SDK_Setting_5850994.json}"
APK_FILE="${APK_FILE:-$ROOT_DIR/dist/skit-djx-debug.apk}"

fail() {
  echo "SDK config check failed: $*" >&2
  exit 1
}

[[ -f "$CANONICAL_FILE" ]] || fail "missing canonical $EXPECTED_FILE"

actual_package="$(jq -r '.license_config[0].PackageName // empty' "$CANONICAL_FILE")"
[[ "$actual_package" == "$EXPECTED_PACKAGE" ]] || \
  fail "canonical package is '$actual_package', expected '$EXPECTED_PACKAGE'"

runtime_files=(
  "$ROOT_DIR/android-djx-runtime/build-djx-apk.sh"
  "$ROOT_DIR/android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitPangleDramaBridge.java"
  "$ROOT_DIR/pages/drama/services/pangle-content.js"
)

rg -q 'SDK_Setting' "${runtime_files[0]}" || fail "build script does not package an SDK setting asset"
rg -q 'PANGLE_SETTING_ASSET' "${runtime_files[1]}" || fail "native bridge does not use the build setting asset"
rg -q 'VITE_PANGLE_DRAMA_SETTING_FILE' "${runtime_files[2]}" || fail "uni-app bridge does not accept the build setting asset"

if [[ -f "$APK_FILE" ]]; then
  apk_settings="$(unzip -Z1 "$APK_FILE" | rg '^assets/SDK_Setting_.*\.json$' || true)"
  apk_setting_count="$(printf '%s\n' "$apk_settings" | sed '/^$/d' | wc -l | tr -d ' ')"
  [[ "$apk_setting_count" -eq 1 ]] || \
    fail "APK contains $apk_setting_count SDK setting files: $apk_settings"
  [[ "$apk_settings" == "assets/$EXPECTED_FILE" ]] || \
    fail "APK contains $apk_settings, expected assets/$EXPECTED_FILE"

  apk_package="$(unzip -p "$APK_FILE" "assets/$EXPECTED_FILE" | jq -r '.license_config[0].PackageName // empty')"
  [[ "$apk_package" == "$EXPECTED_PACKAGE" ]] || \
    fail "APK SDK package is '$apk_package', expected '$EXPECTED_PACKAGE'"
fi

echo "SDK config check passed: $EXPECTED_FILE -> $EXPECTED_PACKAGE"
