import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString(
    'base64',
  )}#${Date.now()}-${Math.random()}`;
}

async function importTakuRewardAd(plugin) {
  globalThis.__skitCancellationPlugin = plugin;
  const nativeBridgeUrl = sourceUrl(`
    export function getNativePlugin() {
      return globalThis.__skitCancellationPlugin;
    }
    export function createNativeTelemetryValidator() { return { accept(value) { return value; } }; }
    export function nativeTelemetryToClientEvent() { return null; }
    export function validateNativeServerProtocol(value) { return value; }
  `);
  const source = readFileSync(
    resolve(root, 'pages/drama/services/taku-reward-ad.js'),
    'utf8',
  ).replace("from './native-bridge';", `from ${JSON.stringify(nativeBridgeUrl)};`);
  return import(sourceUrl(source));
}

test('pending native rewarded loading is cancelled without waiting for a callback', async () => {
  let cancelCalls = 0;
  const neverSettles = new Promise(() => {});
  const rewardAd = await importTakuRewardAd({
    cancelRewardedVideo() {
      cancelCalls += 1;
      return neverSettles;
    },
  });

  const result = rewardAd.cancelPendingRewardedVideoAd();

  assert.equal(result, true);
  assert.equal(cancelCalls, 1);
});

test('cancellation is a safe no-op when an older native shell lacks the method', async () => {
  const rewardAd = await importTakuRewardAd({});
  assert.equal(rewardAd.cancelPendingRewardedVideoAd(), false);
});

test('native bootstrap cancellation terminates the original show before acknowledging cancel', () => {
  const bridge = readFileSync(
    resolve(
      root,
      'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
    ),
    'utf8',
  );
  const cancelMethod = bridge.match(
    /private void cancelRewardedVideo\(String id\) \{([\s\S]*?)\n    \}/,
  )?.[1];

  assert.ok(cancelMethod, 'native cancellation method must exist');
  assert.match(cancelMethod, /boolean bootstrapCancelled = cancelBootstrapRegistration\(\)/);
  assert.match(cancelMethod, /RewardedRequestOwnership\.Request request/);
  assert.match(cancelMethod, /emitTerminalError\([\s\S]*?request\.getCallbackId\(\)/);
  assert.match(cancelMethod, /TakuFailureReason\.SDK_FAILURE/);
  assert.match(cancelMethod, /put\(result, "cancelled", cancelled\)/);
  assert.ok(
    cancelMethod.indexOf('emitTerminalError') < cancelMethod.indexOf('emit(id, result, true)'),
    'the original show must become terminal before the cancel acknowledgement',
  );
});

test('native rewarded telemetry is serialized on the activity UI thread', () => {
  const bridge = readFileSync(
    resolve(
      root,
      'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
    ),
    'utf8',
  );

  assert.match(
    bridge,
    /telemetry -> activity\.runOnUiThread\([\s\S]*?handleRewardedTelemetry\(id, telemetry\)/,
  );
  assert.match(bridge, /requestOwnership\.clearIfCurrent\(id\)/);
});
