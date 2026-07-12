#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_FILE="SDK_Setting_5850994.json"
EXPECTED_PACKAGE="top.neoshen.xingheyingguan"
CANONICAL_FILE="$ROOT_DIR/nativeplugins/SkitPangleDrama/android/assets/$EXPECTED_FILE"
APK_FILE="$ROOT_DIR/dist/skit-djx-debug.apk"

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
  "$ROOT_DIR/nativeplugins/SkitPangleDrama/android/src/main/java/com/skit/nativeplugins/pangle/SkitPangleDramaModule.java"
  "$ROOT_DIR/pages/drama/services/pangle-content.js"
)

for file in "${runtime_files[@]}"; do
  rg -q "$EXPECTED_FILE" "$file" || fail "$file does not reference $EXPECTED_FILE"
  if rg -q 'SDK_Setting_5839007\.json' "$file"; then
    fail "$file still references SDK_Setting_5839007.json"
  fi
done

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
