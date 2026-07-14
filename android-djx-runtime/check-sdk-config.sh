#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_CODE="${SKIT_PROFILE_CODE:-${1:-}}"
if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "Usage: SKIT_PROFILE_CODE=PROFILE android-djx-runtime/check-sdk-config.sh" >&2
  exit 1
fi
SKIT_PROFILE_CODE="$PROFILE_CODE" \
  SKIT_ALLOW_DEBUG_RUNTIME_DEFAULTS=1 \
  "$ROOT_DIR/android-djx-runtime/verify-production-apk.sh"
