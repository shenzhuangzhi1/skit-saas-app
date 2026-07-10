#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_DIR="$ROOT_DIR/android-preview-webview"
DEFAULT_H5_DIR="$ROOT_DIR/unpackage/dist/build/h5-apk-preview"
H5_DIR="${H5_DIR:-$DEFAULT_H5_DIR}"
BUILD_DIR="$PREVIEW_DIR/build"
SDK_DIR="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$SDK_DIR/build-tools/36.1.0"
ANDROID_JAR="$SDK_DIR/platforms/android-36.1/android.jar"
JAVAC="${JAVAC:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto/bin/javac}"
KEYTOOL="${KEYTOOL:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto/bin/keytool}"

if [[ ! -d "$H5_DIR" ]]; then
  echo "Missing H5 build directory: $H5_DIR" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/assets/www" "$BUILD_DIR/compiled" "$BUILD_DIR/classes" "$BUILD_DIR/dex"
cp -R "$H5_DIR"/. "$BUILD_DIR/assets/www/"
cp "$PREVIEW_DIR/preview-runtime.js" "$BUILD_DIR/assets/www/preview-runtime.js"
if ! grep -q 'preview-runtime.js' "$BUILD_DIR/assets/www/index.html"; then
  perl -0pi -e 's#</body>#  <script src="./preview-runtime.js"></script>\n  </body>#' "$BUILD_DIR/assets/www/index.html"
fi

"$BUILD_TOOLS/aapt2" compile --dir "$PREVIEW_DIR/res" -o "$BUILD_DIR/compiled.zip"
"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$PREVIEW_DIR/AndroidManifest.xml" \
  -o "$BUILD_DIR/resources.apk" \
  "$BUILD_DIR/compiled.zip" \
  --java "$BUILD_DIR/generated" \
  --min-sdk-version 24 \
  --target-sdk-version 36

"$JAVAC" -source 17 -target 17 \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD_DIR/classes" \
  "$PREVIEW_DIR/src/com/skit/preview/MainActivity.java" \
  "$BUILD_DIR/generated/com/skit/preview/R.java"

CLASS_FILES=()
while IFS= read -r class_file; do
  CLASS_FILES+=("$class_file")
done < <(find "$BUILD_DIR/classes" -name '*.class' -print)
"$BUILD_TOOLS/d8" \
  --lib "$ANDROID_JAR" \
  --output "$BUILD_DIR/dex" \
  "${CLASS_FILES[@]}"

cp "$BUILD_DIR/resources.apk" "$BUILD_DIR/skit-preview-unsigned.apk"
(cd "$BUILD_DIR/dex" && zip -q -u "$BUILD_DIR/skit-preview-unsigned.apk" classes.dex)
(cd "$BUILD_DIR" && zip -q -r "$BUILD_DIR/skit-preview-unsigned.apk" assets)

"$BUILD_TOOLS/zipalign" -f 4 "$BUILD_DIR/skit-preview-unsigned.apk" "$BUILD_DIR/skit-preview-aligned.apk"

KEYSTORE="$BUILD_DIR/debug.keystore"
"$KEYTOOL" -genkeypair \
  -keystore "$KEYSTORE" \
  -storepass android \
  -keypass android \
  -alias androiddebugkey \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Android Debug,O=Skit,C=CN" >/dev/null

"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$BUILD_DIR/skit-preview-debug.apk" \
  "$BUILD_DIR/skit-preview-aligned.apk"

"$BUILD_TOOLS/apksigner" verify "$BUILD_DIR/skit-preview-debug.apk"
echo "$BUILD_DIR/skit-preview-debug.apk"
