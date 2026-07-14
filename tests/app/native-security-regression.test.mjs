import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const controllerPath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuRewardedAdController.java';
const runtimeBridgePath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitRuntimeUpdateBridge.java';
const mainActivityPath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/MainActivity.java';
const playerBridgePath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitPangleDramaBridge.java';
const originGuardPath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/BridgeOriginGuard.java';
const nativeApiClientPath =
  'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java';

test('Taku creates a fresh ad per session and binds local extra before load', () => {
  const source = read(controllerPath);
  assert.doesNotMatch(source, /\bpreload\s*\(/);
  assert.match(source, /new ATRewardVideoAd\s*\(/);
  const localExtra = source.indexOf('setLocalExtra');
  const load = source.indexOf('.load(');
  assert.ok(localExtra >= 0 && load > localExtra, 'setLocalExtra must happen before load');
  assert.match(source, /ATAdConst\.KEY\.USER_ID/);
  assert.match(source, /ATAdConst\.KEY\.USER_CUSTOM_DATA/);
  assert.match(source, /showCustomExt\s*\(\s*protocol\.getSessionId\(\)\s*\)/);
  assert.match(source, /getShowId\s*\(\s*\)/);
  assert.match(source, /session\.machine\.initializing\s*\(\s*\)/);
});

test('native sources contain no local reward success or sentinel fallback', () => {
  const roots = [
    'android-djx-runtime/app/src/main/java',
    'nativeplugins/SkitPangleDrama/android/src/main/java',
    'pages/drama',
    'android-djx-runtime/static-www',
  ];
  const files = [];
  const visit = (relativePath) => {
    const absolutePath = resolve(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      for (const name of readdirSync(absolutePath)) visit(`${relativePath}/${name}`);
      return;
    }
    if (/\.(?:java|js|vue|html)$/.test(relativePath)) files.push(relativePath);
  };
  roots.forEach(visit);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /DJXRewardAdResult\s*\(\s*true\b/);
    assert.doesNotMatch(source, /skit-local-unlock|local unlock fallback|unlocked\.add/i);
  }
});

test('native player requires and server-validates the short-lived player grant', () => {
  const bridge = read(playerBridgePath);
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const client = read(nativeApiClientPath);
  assert.match(bridge, /playerGrant/);
  assert.match(bridge, /grantToken/);
  assert.match(bridge, /optLong\s*\(\s*value\s*,\s*"expiresAt"/);
  assert.match(client, /X-Skit-Player-Grant/);
  assert.match(client, /X-Skit-Native-Version/);
  assert.match(client, /X-Skit-Ad-Protocol-Version/);
  assert.match(client, /\/skit\/member\/native/);
  assert.match(player, /NativeRewardGate/);
  assert.match(player, /server_entitlement/);
  assert.match(player, /unlockGeneration/);
  assert.match(player, /cancelActiveSession\s*\(/);
});

test('native capabilities use a main-frame origin-aware message channel and external pages leave the WebView', () => {
  const main = read(mainActivityPath);
  const guard = read(originGuardPath);
  const runtimeJs = read('android-djx-runtime/djx-runtime.js');
  assert.doesNotMatch(main, /addJavascriptInterface/);
  assert.match(main, /WebViewCompat\.addWebMessageListener/);
  assert.match(main, /isMainFrame/);
  assert.match(main, /isTrustedMessageOrigin/);
  assert.match(main, /WebViewCompat\.removeWebMessageListener/);
  assert.match(main, /Intent\.ACTION_VIEW/);
  assert.match(main, /isTrustedTopLevel/);
  assert.match(main, /originGuard\.updateTopLevel\s*\(\s*url\s*\)/);
  assert.match(main, /if\s*\(\s*!request\.isForMainFrame\(\)\s*\)/);
  assert.match(main, /return\s+!originGuard\.isTrustedTopLevel/);
  assert.match(guard, /volatile String currentTopLevelUrl/);
  assert.match(guard, /isTrustedMessageOrigin/);
  assert.doesNotMatch(guard, /webView\.getUrl\s*\(/);
  assert.match(runtimeJs, /window\.SkitNativeBridge/);
  assert.doesNotMatch(runtimeJs, /window\.Skit(?:PangleDrama|TakuAd|RuntimeUpdate)Native/);
  assert.doesNotMatch(read('sheep/router/index.js'), /pages\/public\/webview/);
  assert.doesNotMatch(read('sheep/components/s-search-block/s-search-block.vue'), /pages\/public\/webview/);
});

test('hot updates require signed scoped manifests and monotonic release state', () => {
  const bridge = read(runtimeBridgePath);
  const gradle = read('android-djx-runtime/app/build.gradle');
  const builder = read('android-djx-runtime/build-hot-bundle.sh');
  const hotWorkflow = read('.github/workflows/hot-update.yml');
  const apkWorkflow = read('.github/workflows/android-production.yml');
  assert.match(bridge, /RuntimeUpdateManifestVerifier/);
  assert.match(bridge, /RUNTIME_UPDATE_PUBLIC_KEY/);
  assert.match(bridge, /highestAcceptedRelease/);
  assert.match(gradle, /SKIT_RUNTIME_UPDATE_PUBLIC_KEY/);
  assert.match(gradle, /SKIT_TENANT_ID/);
  assert.match(builder, /SKIT_HOT_MANIFEST_SIGNING_KEY/);
  assert.match(builder, /signature/);
  assert.match(builder, /PUBLIC_KEY_BITS/);
  assert.match(builder, /SKIT_TENANT_ID must equal SKIT_AGENT_CODE/);
  assert.match(builder, /\[A-Z0-9_-\]\{3,32\}/);
  const apkBuilder = read('android-djx-runtime/build-djx-apk.sh');
  assert.match(apkBuilder, /PUBLIC_KEY_BITS/);
  assert.match(apkBuilder, /SKIT_TENANT_ID must equal SKIT_AGENT_CODE/);
  assert.match(apkBuilder, /\[A-Z0-9_-\]\{3,32\}/);
  assert.match(read('android-djx-runtime/verify-production-apk.sh'), /PUBLIC_KEY_BITS/);
  assert.match(hotWorkflow, /SKIT_TENANT_ID:\s*\$\{\{\s*inputs\.profile_code\s*\}\}/);
  assert.match(apkWorkflow, /profile_code:/);
  assert.match(apkWorkflow, /SKIT_TENANT_ID:\s*\$\{\{\s*inputs\.profile_code\s*\}\}/);
});

test('runtime update JavaScript forwards only the complete signed manifest', () => {
  const updater = read('sheep/services/app-update.js');
  for (const field of [
    'tenantId',
    'applicationId',
    'bundleUrl',
    'bundleSha256',
    'protocolVersion',
    'releaseNo',
    'signature',
  ]) {
    assert.match(updater, new RegExp(`\\b${field}\\b`));
  }
  assert.match(updater, /highestAcceptedRelease/);
  assert.doesNotMatch(updater, /sha256:\s*String\(manifest\.sha256/);
});

test('production APK builds require explicit monotonic Android version metadata', () => {
  const gradle = read('android-djx-runtime/app/build.gradle');
  const manifest = read('android-djx-runtime/app/src/main/AndroidManifest.xml');
  const builder = read('android-djx-runtime/build-djx-apk.sh');
  const workflow = read('.github/workflows/android-production.yml');
  assert.match(gradle, /SKIT_VERSION_CODE/);
  assert.match(gradle, /SKIT_VERSION_NAME/);
  assert.match(builder, /SKIT_VERSION_CODE/);
  assert.match(builder, /SKIT_VERSION_NAME/);
  assert.match(builder, /SKIT_RELEASE_CERT_SHA256/);
  assert.match(workflow, /native_version_code/);
  assert.match(workflow, /native_version_name/);
  assert.match(workflow, /SKIT_RELEASE_CERT_SHA256/);
  assert.match(builder, /SKIT_ALLOW_DEBUG_RUNTIME_DEFAULTS/);
  const verifier = read('android-djx-runtime/verify-production-apk.sh');
  assert.match(verifier, /SKIT_ALLOW_DEBUG_RUNTIME_DEFAULTS/);
  assert.match(verifier, /apksigner/);
  assert.match(verifier, /debuggable/);
  assert.match(verifier, /s\/\^V\[0-9\]\[0-9\.\]\* Signer/);
  assert.match(verifier, /sort -u/);
  assert.match(
    manifest,
    /tools:replace="[^"]*android:usesCleartextTraffic[^"]*"/,
    'the app manifest must own the cleartext policy over advertising SDK manifests',
  );
});

test('checked-in fallback bundle and page logs contain no legacy local authorization truth', () => {
  const staticBundle = read('android-djx-runtime/static-www/index.html');
  assert.doesNotMatch(staticBundle, /skit-local-unlock|onRewardVerify\s*\(\s*true/);
  assert.doesNotMatch(staticBundle, /unlocked\.add|function\s+unlockRange/);
  const play = read('pages/drama/play.vue');
  assert.doesNotMatch(play, /console\.(?:warn|log|error)\([^\n]*currentVideoUrl/);
});
