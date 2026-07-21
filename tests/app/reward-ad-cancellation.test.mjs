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
