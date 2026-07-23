import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('protected requests read auth state through the same storage adapter that persists login', () => {
  const requestSource = read('sheep/request/index.js');
  const userStoreSource = read('sheep/store/user.js');
  const authAccessors = requestSource.slice(
    requestSource.indexOf('/** 获得访问令牌 */'),
    requestSource.indexOf('const request = (config) =>'),
  );

  assert.match(userStoreSource, /safeUni\.setStorageSync\('token', token\)/);
  assert.match(requestSource, /import safeUni from '@\/sheep\/helper\/uni'/);
  assert.match(
    authAccessors,
    /getAccessToken[\s\S]*?safeUni\.getStorageSync\('token'\)/,
    'the bearer token must not be read through a different WebView storage codec',
  );
  assert.match(
    authAccessors,
    /getRefreshToken[\s\S]*?safeUni\.getStorageSync\('refresh-token'\)/,
  );
  assert.match(authAccessors, /getTenantId[\s\S]*?safeUni\.getStorageSync\('tenant-id'\)/);
});
