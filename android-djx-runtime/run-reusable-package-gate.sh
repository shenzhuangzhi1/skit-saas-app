#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_CODE="${SKIT_PROFILE_CODE:-${SKIT_AGENT_CODE:-}}"
APK_PATH="${APK_FILE:-${1:-}}"
GATE_SCRIPT="$ROOT_DIR/android-djx-runtime/verify-agent-apk.sh"

if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "Reusable package gate failed: SKIT_PROFILE_CODE is missing or invalid" >&2
  exit 2
fi
if [[ ! -f "$APK_PATH" ]]; then
  echo "Reusable package gate failed: APK_FILE is missing" >&2
  exit 2
fi
if [[ ! -x "$GATE_SCRIPT" ]]; then
  echo "Reusable package gate failed: controlled verify-agent-apk.sh is missing or not executable" >&2
  exit 2
fi

exec "$GATE_SCRIPT" \
  --project "$ROOT_DIR" \
  --profile "$PROFILE_CODE" \
  --apk "$APK_PATH"
