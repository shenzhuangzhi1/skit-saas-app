import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function importSource(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    return null;
  }
  const source = readFileSync(path, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString(
    'base64',
  )}#${Date.now()}-${Math.random()}`;
  return import(url);
}

const subject = await importSource('sheep/services/client-runtime.js');

function requireSubject() {
  assert.ok(subject, 'client-runtime.js must exist');
  return subject;
}

test('does not invent runtime headers when the native bridge is unavailable', async () => {
  const { buildClientRuntimeHeaders, createClientRuntimeProvider } = requireSubject();
  const provider = createClientRuntimeProvider(() => null);

  assert.equal(await provider(), null);
  assert.deepEqual(buildClientRuntimeHeaders(null), {});
});

test('retries runtime discovery after the bridge becomes available', async () => {
  const { createClientRuntimeProvider } = requireSubject();
  let bridgeReady = false;
  let calls = 0;
  const provider = createClientRuntimeProvider(() => {
    if (!bridgeReady) {
      return null;
    }
    return {
      getInfo(payload, callback) {
        calls += 1;
        assert.deepEqual(payload, {});
        callback({
          success: true,
          nativeVersion: '2026.07.18-debug',
          protocolVersion: 1,
        });
      },
    };
  });

  assert.equal(await provider(), null);
  bridgeReady = true;
  assert.deepEqual(await provider(), {
    nativeVersion: '2026.07.18-debug',
    protocolVersion: 1,
  });
  assert.equal(calls, 1);
});

test('reads and caches the native runtime metadata', async () => {
  const { createClientRuntimeProvider } = requireSubject();
  let calls = 0;
  const provider = createClientRuntimeProvider(() => ({
    getInfo(payload, callback) {
      calls += 1;
      assert.deepEqual(payload, {});
      callback({
        success: true,
        nativeVersion: '2026.07.17-local',
        protocolVersion: 1,
      });
    },
  }));

  const first = await provider();
  const second = await provider();

  assert.deepEqual(first, {
    nativeVersion: '2026.07.17-local',
    protocolVersion: 1,
  });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test('maps valid runtime metadata to the backend headers', () => {
  const { buildClientRuntimeHeaders } = requireSubject();

  assert.deepEqual(
    buildClientRuntimeHeaders({
      nativeVersion: '2026.07.17-local',
      protocolVersion: 1,
    }),
    {
      'X-Skit-Native-Version': '2026.07.17-local',
      'X-Skit-Ad-Protocol-Version': '1',
    },
  );
  assert.deepEqual(buildClientRuntimeHeaders({ nativeVersion: 'local', protocolVersion: 1 }), {});
});
