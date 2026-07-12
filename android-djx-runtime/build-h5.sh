#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HBUILDERX_DIR="${HBUILDERX_DIR:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite}"
HBUILDERX_APP_ROOT="${HX_APP_ROOT:-$(cd "$HBUILDERX_DIR/../.." && pwd)}"
UNI_CLI="${UNI_CLI:-$HBUILDERX_DIR/node_modules/.bin/uni}"
UNI_NODE_MODULES="$HBUILDERX_DIR/node_modules"
OUTPUT_DIR="${H5_DIR:-$ROOT_DIR/unpackage/dist/build/h5-android-runtime}"
BUILD_MODE="${UNI_BUILD_MODE:-production}"

if [[ -n "${SKIT_API_BASE_URL:-}" ]]; then
  if [[ -n "${SKIT_AGENT_CODE:-}" && ! "$SKIT_API_BASE_URL" =~ ^https:// ]]; then
    echo "Agent H5 builds require SKIT_API_BASE_URL with HTTPS" >&2
    exit 1
  fi
  export SHOPRO_BASE_URL="$SKIT_API_BASE_URL"
  export SHOPRO_TRIAL_BASE_URL="$SKIT_API_BASE_URL"
fi
if [[ -n "${SKIT_AGENT_CODE:-}" ]]; then
  export VITE_SKIT_AGENT_CODE="$SKIT_AGENT_CODE"
fi

if [[ ! -x "$UNI_CLI" ]]; then
  echo "HBuilderX uni-app CLI is unavailable: $UNI_CLI" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
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

echo "$OUTPUT_DIR"
