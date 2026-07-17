#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="${repo_root}/android-djx-runtime"
apk_file="${runtime_dir}/app/build/outputs/apk/debug/app-debug.apk"
cd "${repo_root}"

command -v node >/dev/null 2>&1 || { echo "Install Node.js before App verification." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Install npm before App verification." >&2; exit 1; }
command -v java >/dev/null 2>&1 || { echo "Install Java 17 before App verification." >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "Install unzip before App verification." >&2; exit 1; }
[[ -d "${HOME}/Library/Android/sdk" ]] || { echo "Install the Android SDK at ~/Library/Android/sdk." >&2; exit 1; }

node -e "for (const file of ['package.json', 'manifest.json', 'pages.json']) JSON.parse(require('fs').readFileSync(file, 'utf8'))"
if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci --ignore-scripts --no-audit --no-fund
  else
    npm install --ignore-scripts --no-audit --no-fund
  fi
fi
npm run check:identity
npm run test:app

gradle_bin=""
if command -v gradle >/dev/null 2>&1; then
  gradle_bin="$(command -v gradle)"
elif [[ -x "${runtime_dir}/.gradle-dist/gradle-8.10.2/bin/gradle" ]]; then
  gradle_bin="${runtime_dir}/.gradle-dist/gradle-8.10.2/bin/gradle"
elif [[ -f "${runtime_dir}/.gradle-dist/gradle-8.10.2-bin.zip" ]]; then
  unzip -q -o "${runtime_dir}/.gradle-dist/gradle-8.10.2-bin.zip" -d "${runtime_dir}/.gradle-dist"
  gradle_bin="${runtime_dir}/.gradle-dist/gradle-8.10.2/bin/gradle"
else
  echo "Install Gradle 8.10.2 or provide android-djx-runtime/.gradle-dist/gradle-8.10.2-bin.zip." >&2
  exit 1
fi

java_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
[[ -n "${java_home}" ]] || { echo "Install a Java 17 JDK for Android verification." >&2; exit 1; }
JAVA_HOME="${java_home}" "${gradle_bin}" --no-daemon -p "${runtime_dir}" \
  :app:testDebugUnitTest :app:assembleDebug

[[ -f "${apk_file}" ]] || { echo "Debug APK was not generated." >&2; exit 1; }
jar tf "${apk_file}" | grep -Fxq 'assets/www/index.html' \
  || { echo "Debug APK is missing assets/www/index.html." >&2; exit 1; }
jar tf "${apk_file}" | grep -Fxq 'assets/www/djx-runtime.js' \
  || { echo "Debug APK is missing assets/www/djx-runtime.js." >&2; exit 1; }
echo "App local verification passed."
