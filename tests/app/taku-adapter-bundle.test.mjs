import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeDir = resolve(root, 'android-djx-runtime');
const lockPath = resolve(runtimeDir, 'taku-adapter-bundle.lock.json');
const verifierPath = resolve(runtimeDir, 'verify-taku-adapter-bundle.mjs');
const bundleDir = resolve(runtimeDir, 'app/libs/taku');
const keepPath = resolve(runtimeDir, 'app/src/main/res/raw/keep.xml');

const expectedArtifacts = new Map([
  ['Baidu_MobAds_SDK-release_v9.450.aar', '2f1bd99a59b83e956c73473c322c7651784c00c99ab295fd8c562d9812c7cdff'],
  ['GDTSDK.unionNormal.4.690.1560.aar', '7f6d3b412ca34968cda186a1022330ce69dc05336973cb01270125335e9d7206'],
  ['anythink_adx_sdk_kuying_6.5.75_necessary.aar', '18556ae241317ad7ec6567f561e8100f2d02a605877aaf5f7786fdfa4755c9c1'],
  ['anythink_common_util_1.1.3.aar', 'c0b668c24108f229bd620c892a86655b0aa9b1ee359c7cb6c46a36f1846b3409'],
  ['anythink_core_6.6.30.aar', '05f1d63db3abdded4bc0b2c0989904e032486c82270be14ff0ae6f8ca3d461fc'],
  ['anythink_network_adx_kuying_sdk_necessary_6.5.75.1.2.aar', '431677454ab746531f3089d0bc4d5e870161419845011cf824549d4eb3a96976'],
  ['anythink_network_baidu_9.450.1.2.aar', '3a1899955fc55a9e11bfe12f628a0d88ef7b4fcddf4c4fa1e811d1eda35f98ca'],
  ['anythink_network_csj_mix_7.6.1.1.1.0.aar', 'f739a4f49ea85537555b1b736aa1cf7e52f696d1731e13dfeee2d5d89c80e3f3'],
  ['anythink_network_gdt_4.690.1560.1.2.aar', '7f34b507142f8a4417e699d46fc32dd756c35b092a5bbea5a6dbd1915eed3109'],
  ['anythink_network_kuaishou_5.4.10.2.1.1.aar', '69deb0289076336515611e562ec12ac60ceb99986b039c0cab9564a0880894e9'],
  ['anythink_network_mobrain_mix_plus_7.6.1.1.1.0.aar', '39c2026077b0fae4330675b2a53b046ee1b36dc94583a0dcfec4c2d8f33c75ae'],
  ['kssdk-ad-5.4.10.2-publishRelease-2d5f51e600.aar', '6e42ead9877944f5918b9a035a30dc0fd4cb15b226caf9535415f891f318ef5a'],
  ['open_ad_sdk_7.6.1.1.aar', 'feb2ec8f716f99903a3a2a62422a496708cb4e8aaeafaeae0583199afc08b48b'],
]);

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function loadLock() {
  assert.ok(existsSync(lockPath), 'the official Taku 6.6.30 bundle lock is required');
  return JSON.parse(readFileSync(lockPath, 'utf8'));
}

test('locks the exact identity-neutral official 13-AAR Taku bundle', () => {
  const lock = loadLock();
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.bundleVersion, '20260722071201');
  assert.equal(lock.officialZipSha256, '16290b41af3c5a06d50edbcfd685238970c5db19697f594de721e8cd97949adf');
  assert.deepEqual(lock.sdkVersions, {
    takuCore: '6.6.30',
    takuAdx: '6.5.75',
    baidu: '9.450',
    gdt: '4.690.1560',
    kuaishou: '5.4.10.2',
    pangleGroMore: '7.6.1.1',
  });
  assert.deepEqual(lock.keepXml, {
    path: 'app/src/main/res/raw/keep.xml',
    sha256: 'b7013883588142b175ae10a53fef2598de82a1f2186ca6a80d7aa422f9001d90',
  });
  assert.equal(lock.artifacts.length, 13);
  assert.deepEqual(
    new Map(lock.artifacts.map(({ file, sha256: digest }) => [file, digest])),
    expectedArtifacts,
  );

  const forbiddenIdentityKeys = new Set([
    'agentid',
    'profileid',
    'networkid',
    'networkfirmid',
    'adsourceid',
    'appid',
    'appkey',
    'placementid',
    'secret',
    'tenantid',
  ]);
  function inspect(value) {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        forbiddenIdentityKeys.has(key.toLowerCase()),
        false,
        `bundle lock must not contain runtime identity key ${key}`,
      );
      inspect(child);
    }
  }
  inspect(lock);
});

test('source verifier checks the locked bundle and rejects checksum drift', () => {
  assert.ok(existsSync(verifierPath), 'the bundle verifier is required');
  const verified = spawnSync(
    process.execPath,
    [verifierPath, '--mode', 'source', '--manifest', lockPath, '--bundle-dir', bundleDir],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.match(verified.stdout, /Taku adapter source bundle verified/);

  const tempDir = mkdtempSync(resolve(tmpdir(), 'skit-taku-lock-test-'));
  try {
    const tampered = loadLock();
    tampered.artifacts[0].sha256 = '0'.repeat(64);
    const tamperedPath = resolve(tempDir, 'tampered.lock.json');
    writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const rejected = spawnSync(
      process.execPath,
      [verifierPath, '--mode', 'source', '--manifest', tamperedPath, '--bundle-dir', bundleDir],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /checksum mismatch/i);

    const changedKeep = resolve(tempDir, 'changed-keep.xml');
    writeFileSync(changedKeep, '<resources />\n');
    const rejectedKeep = spawnSync(
      process.execPath,
      [
        verifierPath,
        '--mode',
        'source',
        '--manifest',
        lockPath,
        '--bundle-dir',
        bundleDir,
        '--keep-file',
        changedKeep,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(rejectedKeep.status, 0);
    assert.match(rejectedKeep.stderr, /keep\.xml checksum mismatch/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('verifier exposes a separate APK mode for merged package evidence', () => {
  const result = spawnSync(
    process.execPath,
    [verifierPath, '--mode', 'apk', '--manifest', lockPath],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--apk is required/);
});

test('Gradle and both formal package gates consume the locked bundle', () => {
  const gradle = read('android-djx-runtime/app/build.gradle');
  const builder = read('android-djx-runtime/build-djx-apk.sh');
  const verifier = read('android-djx-runtime/verify-production-apk.sh');
  const ci = read('.github/workflows/cicd.yml');
  const productionCi = read('.github/workflows/android-production.yml');
  const reusableGate = read('android-djx-runtime/run-reusable-package-gate.sh');

  assert.match(gradle, /taku-adapter-bundle\.lock\.json/);
  assert.match(gradle, /verifyTakuAdapterBundle/);
  assert.match(gradle, /preBuild[\s\S]*dependsOn[\s\S]*verifyTakuAdapterBundle/);
  assert.match(gradle, /takuBundle\.artifacts\.collect/);
  assert.match(gradle, /implementation files\(takuAars\)/);
  assert.doesNotMatch(gradle, /implementation\s+['"]com\.pangle_beta\.cn:mediation-sdk/);
  assert.doesNotMatch(
    gradle,
    /configurations\.configureEach\s*\{\s*exclude group: 'com\.pangle_beta\.cn'/,
  );
  assert.doesNotMatch(
    gradle,
    /exclude group: 'com\.pangle_beta\.cn', module: 'mediation-sdk'/,
    'the dependency contract must fail rather than hide a future duplicate candidate',
  );
  assert.match(gradle, /verifyTakuDependencyContract/);
  assert.match(gradle, /resolvedArtifacts[\s\S]*com\.pangle_beta\.cn[\s\S]*mediation-sdk/);
  assert.doesNotMatch(gradle, /pickFirst[^\n]*\.class|exclude[^\n]*\.class/);
  for (const source of [builder, verifier]) {
    assert.match(source, /verify-taku-adapter-bundle\.mjs/);
    assert.match(source, /taku-adapter-bundle\.lock\.json/);
  }
  assert.match(builder, /run-reusable-package-gate\.sh/);
  assert.match(reusableGate, /verify-agent-apk\.sh/);
  assert.match(reusableGate, /--project[\s\S]*--profile[\s\S]*--apk/);
  assert.match(ci, /verify-taku-adapter-bundle\.mjs/);
  assert.match(productionCi, /verify-taku-adapter-bundle\.mjs/);
});

test('official keep rules and merged-permission policy are locked', () => {
  const keep = readFileSync(keepPath);
  assert.equal(sha256(keep), 'b7013883588142b175ae10a53fef2598de82a1f2186ca6a80d7aa422f9001d90');
  const lock = loadLock();
  assert.deepEqual(lock.forbiddenMergedPermissions, [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.GET_TASKS',
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.READ_PHONE_STATE',
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]);
  const appManifest = read('android-djx-runtime/app/src/main/AndroidManifest.xml');
  for (const permission of lock.forbiddenMergedPermissions) {
    const escaped = permission.replaceAll('.', '\\.');
    assert.match(
      appManifest,
      new RegExp(
        `<uses-permission\\s+android:name="${escaped}"\\s+tools:node="remove"\\s*/>`,
      ),
      `${permission} must be removed from the merged manifest`,
    );
  }
});

test('App reward production code remains Taku-only while adapters are controlled by the lock', () => {
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuRewardedAdController.java',
  );
  assert.match(controller, /new ATRewardVideoAd\s*\(/);
  assert.doesNotMatch(
    controller,
    /com\.(?:baidu\.mobads|qq\.e\.ads|kwad\.sdk|bytedance\.sdk\.openadsdk).*(?:Reward|reward)/,
  );
  const lock = loadLock();
  const markers = lock.artifacts.flatMap((artifact) => artifact.classMarkers || []);
  for (const marker of [
    'com/anythink/network/baidu/BaiduATRewardedVideoAdapter.class',
    'com/anythink/network/gdt/GDTATRewardedVideoAdapter.class',
    'com/anythink/network/ks/KSATRewardedVideoAdapter.class',
    'com/anythink/network/toutiao/TTATRewardedVideoAdapter.class',
  ]) {
    assert.ok(markers.includes(marker), `missing controlled adapter marker ${marker}`);
  }
});
