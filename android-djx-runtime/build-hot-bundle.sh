#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_CODE="${SKIT_AGENT_CODE:-}"
HOT_VERSION="${SKIT_HOT_VERSION:-}"
API_BASE_URL="${SKIT_API_BASE_URL:-}"
OUTPUT_DIR="${SKIT_HOT_OUTPUT_DIR:-$ROOT_DIR/dist/hot-updates}"
H5_DIR="${H5_DIR:-$ROOT_DIR/unpackage/dist/build/hot-update}"

if [[ ! "$AGENT_CODE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "SKIT_AGENT_CODE is required and may only contain letters, numbers, dot, underscore, or dash" >&2
  exit 1
fi
if [[ ! "$HOT_VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}([-.][A-Za-z0-9._-]+)?$ ]]; then
  echo "SKIT_HOT_VERSION must be a release version such as 2.3.0" >&2
  exit 1
fi
if [[ ! "$API_BASE_URL" =~ ^https:// ]]; then
  echo "SKIT_API_BASE_URL must be HTTPS" >&2
  exit 1
fi

export SKIT_AGENT_CODE="$AGENT_CODE"
export SKIT_API_BASE_URL="$API_BASE_URL"
export H5_DIR
"$ROOT_DIR/android-djx-runtime/build-h5.sh"

STAGING_DIR="$ROOT_DIR/.deploy/hot-update-${AGENT_CODE}-${HOT_VERSION}"
ARCHIVE_DIR="$OUTPUT_DIR/$AGENT_CODE"
ARCHIVE_FILE="$ARCHIVE_DIR/$HOT_VERSION.zip"
trap 'rm -rf "$STAGING_DIR"' EXIT
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$ARCHIVE_DIR"
cp -R "$H5_DIR"/. "$STAGING_DIR"/
cp "$ROOT_DIR/android-djx-runtime/djx-runtime.js" "$STAGING_DIR/djx-runtime.js"
if ! grep -q 'djx-runtime.js' "$STAGING_DIR/index.html"; then
  perl -0pi -e 's#</body>#  <script src="./djx-runtime.js"></script>\n  </body>#' "$STAGING_DIR/index.html"
fi

python3 - "$STAGING_DIR" "$ARCHIVE_FILE" <<'PY'
import os
import sys
import zipfile

source, target = sys.argv[1:]
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for root, _, files in os.walk(source):
        for name in sorted(files):
            path = os.path.join(root, name)
            archive.write(path, os.path.relpath(path, source))
PY

SHA256="$(shasum -a 256 "$ARCHIVE_FILE" | awk '{print $1}')"
printf 'archive=%s\nsha256=%s\nagent_code=%s\nhot_version=%s\n' \
  "$ARCHIVE_FILE" "$SHA256" "$AGENT_CODE" "$HOT_VERSION"
