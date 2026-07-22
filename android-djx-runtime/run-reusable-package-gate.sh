#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_CODE="${SKIT_PROFILE_CODE:-${SKIT_AGENT_CODE:-}}"
APK_PATH="${APK_FILE:-${1:-}}"
GATE_SCRIPT="${SKIT_REUSABLE_PACKAGE_GATE:-}"

if [[ ! "$PROFILE_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "Reusable package gate failed: SKIT_PROFILE_CODE is missing or invalid" >&2
  exit 2
fi
if [[ ! -f "$APK_PATH" ]]; then
  echo "Reusable package gate failed: APK_FILE is missing" >&2
  exit 2
fi
if [[ -z "$GATE_SCRIPT" || ! -x "$GATE_SCRIPT" ]]; then
  echo "Reusable package gate failed: set SKIT_REUSABLE_PACKAGE_GATE to verify-agent-apk.sh" >&2
  exit 2
fi
if [[ "$(basename "$GATE_SCRIPT")" != "verify-agent-apk.sh" ]]; then
  echo "Reusable package gate failed: expected verify-agent-apk.sh" >&2
  exit 2
fi

exec "$GATE_SCRIPT" \
  --project "$ROOT_DIR" \
  --profile "$PROFILE_CODE" \
  --apk "$APK_PATH"
