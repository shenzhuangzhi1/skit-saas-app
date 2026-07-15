import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString(
    'base64',
  )}#${Date.now()}-${Math.random()}`;
}

async function importPangleContent(plugin) {
  globalThis.__skitPangleSecurityPlugin = plugin;
  const nativeBridgeUrl = sourceUrl(`
    export function getNativePlugin() {
      return globalThis.__skitPangleSecurityPlugin;
    }
    export async function callNativeMethod(plugin, method, payload) {
      return plugin[method](payload);
    }
  `);
  const dramaDataUrl = sourceUrl('export function cacheExternalDramas() {}');
  const source = read('pages/drama/services/pangle-content.js')
    .replace("from './native-bridge';", `from ${JSON.stringify(nativeBridgeUrl)};`)
    .replace("from '@/pages/drama/data';", `from ${JSON.stringify(dramaDataUrl)};`);
  return import(sourceUrl(source));
}

test('H5 cannot send malicious freeSet or lockSet policy to the native player', async () => {
  let openPayload;
  const content = await importPangleContent({
    start: async () => ({ success: true }),
    openPlayer: async (payload) => {
      openPayload = payload;
      return { success: true };
    },
  });

  await content.openPangleDramaPlayer({
    drama: {
      id: '901',
      pangleDramaId: 901,
      freeEpisodes: 999,
      unlockSize: 999,
    },
    episode: 7,
    freeSet: 999,
    lockSet: 999,
    playerGrant: {
      grantId: 17,
      dramaId: 901,
      grantToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      expiresAt: '2099-01-01T00:00:00Z',
    },
  });

  assert.ok(openPayload, 'native openPlayer payload must be emitted');
  assert.equal(Object.hasOwn(openPayload, 'freeSet'), false);
  assert.equal(Object.hasOwn(openPayload, 'lockSet'), false);
});

test('native bridge and activity never read H5 or Intent unlock-range policy', () => {
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitPangleDramaBridge.java',
  );
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );

  assert.doesNotMatch(bridge, /args\.optInt\("freeSet"/);
  assert.doesNotMatch(bridge, /args\.optInt\("lockSet"/);
  assert.doesNotMatch(player, /getIntExtra\("freeSet"/);
  assert.doesNotMatch(player, /getIntExtra\("lockSet"/);
  assert.match(player, /NativeEpisodeUnlockPolicy\.FREE_SET/);
  assert.match(player, /NativeEpisodeUnlockPolicy\.LOCK_SET/);
});

test('reward status and already-entitled outcomes still require exact episode entitlement', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );

  assert.match(
    player,
    /"ALREADY_ENTITLED"\.equals\(result\.getOutcome\(\)\)[\s\S]*?verifyAuthoritativeEpisodeEntitlement/,
  );
  assert.match(
    player,
    /decision == NativeRewardGate\.Decision\.GRANT[\s\S]*?verifyAuthoritativeEpisodeEntitlement/,
  );
  assert.match(
    player,
    /verifyAuthoritativeEpisodeEntitlement[\s\S]*?nativeApiClient\.getEntitlements/,
  );
  assert.match(player, /unlockPolicy\.consumeIfEntitled/);
});
