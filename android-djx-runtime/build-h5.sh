#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HBUILDERX_DIR="${HBUILDERX_DIR:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite}"
UNI_CLI="${UNI_CLI:-$HBUILDERX_DIR/node_modules/.bin/uni}"
UNI_NODE_MODULES="$HBUILDERX_DIR/node_modules"
OUTPUT_DIR="${H5_DIR:-$ROOT_DIR/unpackage/dist/build/h5-android-runtime}"
BUILD_MODE="${UNI_BUILD_MODE:-production}"
BUILD_OUTPUT_ROOT="$ROOT_DIR/unpackage/dist/build"
mkdir -p "$BUILD_OUTPUT_ROOT"
BUILD_OUTPUT_ROOT="$(cd "$BUILD_OUTPUT_ROOT" && pwd -P)"
OUTPUT_DIR="$(
  python3 - "$OUTPUT_DIR" "$BUILD_OUTPUT_ROOT" <<'PY'
import os
import sys

output_dir = os.path.realpath(os.path.abspath(sys.argv[1]))
controlled_root = os.path.realpath(os.path.abspath(sys.argv[2]))
try:
    inside_root = os.path.commonpath([output_dir, controlled_root]) == controlled_root
except ValueError:
    inside_root = False
if not inside_root or output_dir == controlled_root:
    raise SystemExit("H5_DIR must be a child of the controlled build root")
print(output_dir)
PY
)"
HBUILDERX_APP_ROOT="${HX_APP_ROOT:-$(cd "$HBUILDERX_DIR/../.." && pwd)}"

if [[ -z "${SKIT_AGENT_CODE:-}" || ! "$SKIT_AGENT_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "SKIT_AGENT_CODE is required for Android H5 builds" >&2
  exit 1
fi
RESOLVED_PROFILE_JSON="$(
  node "$ROOT_DIR/android-djx-runtime/resolve-build-profile.mjs" \
    --profile-code "$SKIT_AGENT_CODE" \
    --profiles-dir "$ROOT_DIR/android-djx-runtime/profiles" \
    --format json
)"
RESOLVED_PROFILE_METADATA="$(
  printf '%s' "$RESOLVED_PROFILE_JSON" | \
    python3 -c 'import json,sys; value=json.load(sys.stdin); print(value["profileVersion"], value["profileSha256"])'
)"
read -r RESOLVED_PROFILE_VERSION RESOLVED_PROFILE_SHA256 <<< "$RESOLVED_PROFILE_METADATA"
if [[ -n "${SKIT_PROFILE_VERSION:-}" && "$SKIT_PROFILE_VERSION" != "$RESOLVED_PROFILE_VERSION" ]]; then
  echo "SKIT_PROFILE_VERSION conflicts with the selected Android build profile" >&2
  exit 1
fi
if [[ -n "${SKIT_PROFILE_SHA256:-}" && "$SKIT_PROFILE_SHA256" != "$RESOLVED_PROFILE_SHA256" ]]; then
  echo "SKIT_PROFILE_SHA256 conflicts with the selected Android build profile" >&2
  exit 1
fi
export SKIT_PROFILE_VERSION="$RESOLVED_PROFILE_VERSION"
export SKIT_PROFILE_SHA256="$RESOLVED_PROFILE_SHA256"
if [[ -z "${SKIT_PROFILE_VERSION:-}" || ! "$SKIT_PROFILE_VERSION" =~ ^[1-9][0-9]*$ ]]; then
  echo "SKIT_PROFILE_VERSION is required for Android H5 builds" >&2
  exit 1
fi
if [[ -z "${SKIT_PROFILE_SHA256:-}" || ! "$SKIT_PROFILE_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "SKIT_PROFILE_SHA256 is required for Android H5 builds" >&2
  exit 1
fi
if [[ -z "${SKIT_API_BASE_URL:-}" || ! "$SKIT_API_BASE_URL" =~ ^https:// ]]; then
  echo "Android H5 builds require SKIT_API_BASE_URL with HTTPS" >&2
  exit 1
fi
export SHOPRO_BASE_URL="$SKIT_API_BASE_URL"
export SHOPRO_TRIAL_BASE_URL="$SKIT_API_BASE_URL"
export VITE_SKIT_AGENT_CODE="$SKIT_AGENT_CODE"

if [[ ! -x "$UNI_CLI" ]]; then
  echo "HBuilderX uni-app CLI is unavailable: $UNI_CLI" >&2
  exit 1
fi

rm -rf -- "$OUTPUT_DIR"
HX_APP_ROOT="$HBUILDERX_APP_ROOT" \
NODE_PATH="$UNI_NODE_MODULES${NODE_PATH:+:$NODE_PATH}" \
UNI_INPUT_DIR="$ROOT_DIR" \
UNI_OUTPUT_DIR="$OUTPUT_DIR" \
"$UNI_CLI" build -p h5 --mode "$BUILD_MODE"

if [[ ! -f "$OUTPUT_DIR/index.html" ]]; then
  echo "uni-app H5 build did not produce index.html: $OUTPUT_DIR" >&2
  exit 1
fi
if ! find "$OUTPUT_DIR/assets" -maxdepth 1 -type f -name 'pages-auth-index*.js' -print -quit | grep -q .; then
  echo "uni-app H5 build omitted the login page; check the HBuilderX CLI context" >&2
  exit 1
fi
if ! grep -Rqs 'mount("#app")' "$OUTPUT_DIR/assets"; then
  echo "uni-app H5 build omitted the application mount; check the HBuilderX CLI context" >&2
  exit 1
fi
if ! grep -Rqs "\"$SKIT_AGENT_CODE\"" "$OUTPUT_DIR"/assets/pages-auth-index*.js; then
  echo "uni-app H5 build omitted the selected SKIT_AGENT_CODE from the login page" >&2
  exit 1
fi
API_BASE_URL_SHA256="$(
  printf '%s' "$SKIT_API_BASE_URL" | \
    python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
)"
printf '{"agentCode":"%s","profileVersion":%s,"profileSha256":"%s","apiBaseUrlSha256":"%s"}\n' \
  "$SKIT_AGENT_CODE" \
  "$SKIT_PROFILE_VERSION" \
  "$SKIT_PROFILE_SHA256" \
  "$API_BASE_URL_SHA256" \
  > "$OUTPUT_DIR/.skit-h5-build-profile.json"

echo "$OUTPUT_DIR"
