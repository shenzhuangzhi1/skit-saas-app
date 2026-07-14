#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_CODE="${SKIT_AGENT_CODE:-}"
HOT_VERSION="${SKIT_HOT_VERSION:-}"
HOT_RELEASE_NO="${SKIT_HOT_RELEASE_NO:-}"
TENANT_ID="${SKIT_TENANT_ID:-}"
APPLICATION_ID="${SKIT_APPLICATION_ID:-}"
PROTOCOL_VERSION="${SKIT_RUNTIME_PROTOCOL_VERSION:-}"
BUNDLE_URL="${SKIT_HOT_BUNDLE_URL:-}"
SIGNING_KEY="${SKIT_HOT_MANIFEST_SIGNING_KEY:-}"
EMBEDDED_PUBLIC_KEY="${SKIT_RUNTIME_UPDATE_PUBLIC_KEY:-}"
API_BASE_URL="${SKIT_API_BASE_URL:-}"
OUTPUT_DIR="${SKIT_HOT_OUTPUT_DIR:-$ROOT_DIR/dist/hot-updates}"
H5_DIR="${H5_DIR:-$ROOT_DIR/unpackage/dist/build/hot-update}"

if [[ ! "$AGENT_CODE" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "SKIT_AGENT_CODE is required and has an invalid format" >&2
  exit 1
fi
if [[ ! "$HOT_VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}([-.][A-Za-z0-9._-]+)?$ ]]; then
  echo "SKIT_HOT_VERSION must be a release version such as 2.3.0" >&2
  exit 1
fi
if [[ ! "$HOT_RELEASE_NO" =~ ^[1-9][0-9]*$ ]]; then
  echo "SKIT_HOT_RELEASE_NO must be a positive monotonic integer" >&2
  exit 1
fi
if [[ ! "$TENANT_ID" =~ ^[A-Z0-9_-]{3,32}$ ]]; then
  echo "SKIT_TENANT_ID is required and has an invalid format" >&2
  exit 1
fi
if [[ "$TENANT_ID" != "$AGENT_CODE" ]]; then
  echo "SKIT_TENANT_ID must equal SKIT_AGENT_CODE" >&2
  exit 1
fi
if [[ ! "$APPLICATION_ID" =~ ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$ ]]; then
  echo "SKIT_APPLICATION_ID is required and has an invalid format" >&2
  exit 1
fi
if [[ ! "$PROTOCOL_VERSION" =~ ^[1-9][0-9]*$ ]]; then
  echo "SKIT_RUNTIME_PROTOCOL_VERSION must be a positive integer" >&2
  exit 1
fi
if [[ ! "$BUNDLE_URL" =~ ^https:// ]]; then
  echo "SKIT_HOT_BUNDLE_URL must be HTTPS" >&2
  exit 1
fi
if [[ ! "$API_BASE_URL" =~ ^https:// ]]; then
  echo "SKIT_API_BASE_URL must be HTTPS" >&2
  exit 1
fi
if [[ ! -f "$SIGNING_KEY" ]]; then
  echo "SKIT_HOT_MANIFEST_SIGNING_KEY must reference a protected RSA private key" >&2
  exit 1
fi
if (( ${#EMBEDDED_PUBLIC_KEY} < 128 || ${#EMBEDDED_PUBLIC_KEY} > 2048 )) ||
   [[ ! "$EMBEDDED_PUBLIC_KEY" =~ ^[A-Za-z0-9+/=]+$ ]]; then
  echo "SKIT_RUNTIME_UPDATE_PUBLIC_KEY must be the APK embedded X.509 key" >&2
  exit 1
fi

PUBLIC_KEY_BITS="$(
  printf '%s' "$EMBEDDED_PUBLIC_KEY" | \
    python3 -c 'import base64,sys; sys.stdout.buffer.write(base64.b64decode(sys.stdin.buffer.read(), validate=True))' | \
    openssl pkey -pubin -inform DER -text -noout 2>/dev/null | \
    sed -n 's/^Public-Key: (\([0-9][0-9]*\) bit)$/\1/p' || true
)"
if [[ ! "$PUBLIC_KEY_BITS" =~ ^[0-9]+$ ]] || (( PUBLIC_KEY_BITS < 2048 )); then
  echo "SKIT_RUNTIME_UPDATE_PUBLIC_KEY must be an RSA key of at least 2048 bits" >&2
  exit 1
fi

DERIVED_PUBLIC_KEY="$(
  openssl pkey -in "$SIGNING_KEY" -pubout -outform DER 2>/dev/null | \
    python3 -c 'import base64,sys; print(base64.b64encode(sys.stdin.buffer.read()).decode())'
)"
if [[ "$DERIVED_PUBLIC_KEY" != "$EMBEDDED_PUBLIC_KEY" ]]; then
  echo "Hot-update signing key does not match SKIT_RUNTIME_UPDATE_PUBLIC_KEY" >&2
  exit 1
fi

export SKIT_AGENT_CODE="$AGENT_CODE"
export SKIT_API_BASE_URL="$API_BASE_URL"
export H5_DIR
"$ROOT_DIR/android-djx-runtime/build-h5.sh"

STAGING_DIR="$ROOT_DIR/.deploy/hot-update-${AGENT_CODE}-${HOT_VERSION}"
ARCHIVE_DIR="$OUTPUT_DIR/$AGENT_CODE"
ARCHIVE_FILE="$ARCHIVE_DIR/$HOT_VERSION.zip"
MANIFEST_FILE="$ARCHIVE_DIR/$HOT_VERSION.manifest.json"
CANONICAL_FILE="$ROOT_DIR/.deploy/hot-update-${AGENT_CODE}-${HOT_VERSION}.canonical"
SIGNATURE_FILE="$ROOT_DIR/.deploy/hot-update-${AGENT_CODE}-${HOT_VERSION}.sig"
trap 'rm -rf "$STAGING_DIR" "$CANONICAL_FILE" "$SIGNATURE_FILE"' EXIT
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$ARCHIVE_DIR" "$(dirname "$CANONICAL_FILE")"
cp -R "$H5_DIR"/. "$STAGING_DIR"/
cp "$ROOT_DIR/android-djx-runtime/djx-runtime.js" "$STAGING_DIR/djx-runtime.js"
if ! grep -q 'djx-runtime.js' "$STAGING_DIR/index.html"; then
  perl -0pi -e 's#</body>#  <script src="./djx-runtime.js"></script>\n  </body>#' "$STAGING_DIR/index.html"
fi

if grep -RIEq 'skit-local-unlock|onRewardVerify[[:space:]]*\([[:space:]]*true|unlocked\.add' \
  "$STAGING_DIR"; then
  echo "Hot-update bundle contains a local reward fallback" >&2
  exit 1
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
cat > "$CANONICAL_FILE" <<EOF
SKIT_RUNTIME_UPDATE_V1
tenantId=$TENANT_ID
applicationId=$APPLICATION_ID
bundleSha256=$SHA256
protocolVersion=$PROTOCOL_VERSION
releaseNo=$HOT_RELEASE_NO
EOF
openssl dgst -sha256 -sign "$SIGNING_KEY" -out "$SIGNATURE_FILE" "$CANONICAL_FILE"
SIGNATURE="$(python3 - "$SIGNATURE_FILE" <<'PY'
import base64
import sys
print(base64.b64encode(open(sys.argv[1], 'rb').read()).decode())
PY
)"
python3 - "$MANIFEST_FILE" "$TENANT_ID" "$APPLICATION_ID" "$BUNDLE_URL" "$SHA256" \
  "$PROTOCOL_VERSION" "$HOT_RELEASE_NO" "$SIGNATURE" <<'PY'
import json
import sys

path, tenant, application, url, sha256, protocol, release, signature = sys.argv[1:]
manifest = {
    "tenantId": tenant,
    "applicationId": application,
    "bundleUrl": url,
    "bundleSha256": sha256,
    "protocolVersion": int(protocol),
    "releaseNo": int(release),
    "signature": signature,
}
with open(path, "w", encoding="utf-8") as output:
    json.dump(manifest, output, ensure_ascii=False, separators=(",", ":"))
    output.write("\n")
PY

printf 'archive=%s\nmanifest=%s\nsha256=%s\nagent_code=%s\nhot_version=%s\nrelease_no=%s\n' \
  "$ARCHIVE_FILE" "$MANIFEST_FILE" "$SHA256" "$AGENT_CODE" "$HOT_VERSION" "$HOT_RELEASE_NO"
