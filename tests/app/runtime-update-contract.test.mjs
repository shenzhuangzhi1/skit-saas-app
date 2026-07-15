import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'sheep/services/app-update.js'), 'utf8')
  .replace("import AppReleaseApi from '@/sheep/api/app/release';", 'const AppReleaseApi = {};');
const subject = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}`
);

const runtime = Object.freeze({
  tenantId: 'tenant-11',
  applicationId: 'com.example.agent',
  protocolVersion: 1,
  highestAcceptedRelease: 41,
  updatesEnabled: true,
});

const manifest = Object.freeze({
  updateAvailable: true,
  hotVersion: '2.3.0',
  tenantId: runtime.tenantId,
  applicationId: runtime.applicationId,
  bundleUrl: 'https://updates.example.com/runtime.zip',
  bundleSha256: 'a'.repeat(64),
  protocolVersion: 1,
  releaseNo: 42,
  signature: `${'A'.repeat(342)}==`,
});

test('forwards exactly the seven signed fields to the native verifier', () => {
  assert.deepEqual(subject.normalizeSignedManifest(manifest, runtime), {
    tenantId: 'tenant-11',
    applicationId: 'com.example.agent',
    bundleUrl: 'https://updates.example.com/runtime.zip',
    bundleSha256: 'a'.repeat(64),
    protocolVersion: 1,
    releaseNo: 42,
    signature: `${'A'.repeat(342)}==`,
  });
});

test('rejects wrong scope, rollback, unsigned, and disabled update manifests', () => {
  for (const [patch, runtimePatch] of [
    [{ tenantId: 'tenant-12' }, {}],
    [{ applicationId: 'com.other.agent' }, {}],
    [{ protocolVersion: 2 }, {}],
    [{ releaseNo: 41 }, {}],
    [{ signature: '' }, {}],
    [{ bundleSha256: 'b'.repeat(63) }, {}],
    [{ bundleUrl: 'http://updates.example.com/runtime.zip' }, {}],
    [{}, { updatesEnabled: false }],
  ]) {
    assert.throws(
      () => subject.normalizeSignedManifest({ ...manifest, ...patch }, { ...runtime, ...runtimePatch }),
      /签名清单|不匹配/,
    );
  }
});

test('hot-update bundles enforce the same real-content production gates as the base APK', () => {
  const apkBuilder = readFileSync(resolve(root, 'android-djx-runtime/build-djx-apk.sh'), 'utf8');
  const hotBuilder = readFileSync(resolve(root, 'android-djx-runtime/build-hot-bundle.sh'), 'utf8');
  const productionEnv = readFileSync(
    resolve(root, 'android-djx-runtime/production-h5-env.sh'),
    'utf8',
  );
  for (const builder of [apkBuilder, hotBuilder]) {
    assert.match(builder, /production-h5-env\.sh/);
  }
  assert.match(productionEnv, /export VITE_DRAMA_MOCK_REWARD_AD="false"/);
  assert.match(productionEnv, /export VITE_DRAMA_REAL_CONTENT_REQUIRED="true"/);
  assert.ok(
    hotBuilder.indexOf('production-h5-env.sh')
      < hotBuilder.indexOf('build-h5.sh'),
    'hot bundle must set the real-content gate before compiling H5',
  );
});
