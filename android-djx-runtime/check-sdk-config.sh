#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APK_FILE="${APK_FILE:-$ROOT_DIR/dist/xingheyingguan-debug.apk}" \
  "$ROOT_DIR/android-djx-runtime/verify-production-apk.sh"
