import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}-${Math.random()}`;
}

async function importDramaData(initialCache) {
  const storage = new Map([
    ['tenant-id', '162'],
    ['skit_drama_member_scope_v1', '162:88'],
    ['skit_external_drama_cache_v1:tenant:162', initialCache],
  ]);
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
  };
  const source = readFileSync(resolve(root, 'pages/drama/data.js'), 'utf8');
  return { data: await import(sourceUrl(source)), storage };
}

test('fresh SDK policy replaces stale cached policy for the same drama', async () => {
  const stale = {
    id: '1286',
    pangleDramaId: 1286,
    freeEpisodes: 8,
    unlockSize: 4,
  };
  const fresh = {
    id: '1286',
    pangleDramaId: 1286,
    freeEpisodes: 0,
    unlockSize: 1,
  };
  const { data } = await importDramaData([stale]);

  const cached = data.cacheExternalDramas([fresh]);

  assert.equal(cached.length, 1);
  assert.deepEqual(cached[0], fresh);
  assert.deepEqual(data.getExternalDramas(), [fresh]);
});

test('history and follows are member scoped while the real catalog is tenant scoped', async () => {
  const drama = {
    id: '1286',
    pangleDramaId: 1286,
    title: 'Real SDK title',
    total: 12,
    freeEpisodes: 2,
    unlockSize: 1,
  };
  const { data, storage } = await importDramaData([drama]);

  data.saveHistory('1286', 3);
  data.toggleFollow('1286');
  assert.equal(data.getHistoryList().length, 1);
  assert.equal(data.isFollowed('1286'), true);

  data.setDramaMemberScope({ tenantId: 162, memberId: 89 });
  assert.deepEqual(data.getHistoryList(), []);
  assert.equal(data.isFollowed('1286'), false);
  assert.deepEqual(data.getExternalDramas(), [drama]);

  data.setDramaMemberScope({ tenantId: 163, memberId: 88 });
  storage.set('tenant-id', '163');
  assert.deepEqual(data.getHistoryList(), []);
  assert.deepEqual(data.getExternalDramas(), []);

  data.setDramaMemberScope({ tenantId: 162, memberId: 88 });
  storage.set('tenant-id', '162');
  assert.equal(data.getHistoryList().length, 1);
  assert.equal(data.isFollowed('1286'), true);
});
