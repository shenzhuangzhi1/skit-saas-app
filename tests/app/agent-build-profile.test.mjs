import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const resolver = resolve(root, 'android-djx-runtime/resolve-build-profile.mjs');
const fixtures = resolve(root, 'tests/app/fixtures/android-profiles');
const invalidFixtures = resolve(root, 'tests/app/fixtures/android-profile-invalid');
const duplicateFixtures = resolve(root, 'tests/app/fixtures/android-profile-duplicates');

function resolveFixture(profileCode, profilesDir = fixtures) {
  const result = spawnSync(
    process.execPath,
    [resolver, '--profile-code', profileCode, '--profiles-dir', profilesDir, '--format', 'json'],
    { encoding: 'utf8' },
  );
  return result;
}

test('two profile codes resolve isolated tenant, package, Pangle, and Taku identities', () => {
  const alphaResult = resolveFixture('AGENT_ALPHA');
  const betaResult = resolveFixture('AGENT_BETA');
  assert.equal(alphaResult.status, 0, alphaResult.stderr);
  assert.equal(betaResult.status, 0, betaResult.stderr);

  const alpha = JSON.parse(alphaResult.stdout);
  const beta = JSON.parse(betaResult.stdout);
  assert.equal(alpha.profileCode, 'AGENT_ALPHA');
  assert.equal(beta.profileCode, 'AGENT_BETA');
  for (const field of [
    'tenantId',
    'applicationId',
    'pangleSiteId',
    'pangleContentAppId',
    'takuAppId',
    'takuRewardPlacementId',
  ]) {
    assert.notEqual(alpha[field], beta[field], `${field} must be profile-isolated`);
  }
  assert.deepEqual(
    [alpha.tenantId, alpha.applicationId, alpha.pangleSiteId, alpha.takuAppId],
    ['AGENT_ALPHA', 'com.example.agentalpha', '100001', 'alpha-taku-app'],
  );
  assert.deepEqual(
    [beta.tenantId, beta.applicationId, beta.pangleSiteId, beta.takuAppId],
    ['AGENT_BETA', 'com.example.agentbeta', '100002', 'beta-taku-app'],
  );
});

test('resolver rejects a filename/profileCode mismatch and path-like profile input', () => {
  const mismatch = resolveFixture('MISMATCH', invalidFixtures);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /profileCode must equal requested profile code MISMATCH/);

  const traversal = resolveFixture('../AGENT_ALPHA');
  assert.notEqual(traversal.status, 0);
  assert.match(traversal.stderr, /canonical uppercase profile code/);
});

test('resolver rejects cross-profile reuse of a native application identity', () => {
  const duplicate = resolveFixture('AGENT_ALPHA', duplicateFixtures);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /applicationId .* is reused by AGENT_ALPHA and AGENT_BETA/);
});

test('production workflows select a versioned repository profile and a profile-scoped Environment', () => {
  const apkWorkflow = readFileSync(resolve(root, '.github/workflows/android-production.yml'), 'utf8');
  const hotWorkflow = readFileSync(resolve(root, '.github/workflows/hot-update.yml'), 'utf8');
  const apkBuilder = readFileSync(resolve(root, 'android-djx-runtime/build-djx-apk.sh'), 'utf8');
  const verifier = readFileSync(resolve(root, 'android-djx-runtime/verify-production-apk.sh'), 'utf8');
  const sdkCheck = readFileSync(resolve(root, 'android-djx-runtime/check-sdk-config.sh'), 'utf8');

  for (const workflow of [apkWorkflow, hotWorkflow]) {
    assert.match(workflow, /environment:\s*android-production-\$\{\{\s*inputs\.profile_code\s*\}\}/);
    assert.match(workflow, /resolve-build-profile\.mjs/);
    assert.match(workflow, /--profile-code\s+"\$PROFILE_CODE"/);
    assert.match(workflow, /--github-env\s+"\$GITHUB_ENV"/);
  }
  assert.doesNotMatch(apkBuilder, /production-profile\.json/);
  const profileExports = apkBuilder.indexOf('export SKIT_APPLICATION_ID="$APPLICATION_ID"');
  const whiteLabelRequirements = apkBuilder.indexOf('for required_name in \\\n');
  assert.ok(profileExports >= 0, 'the profile application identity must be exported');
  assert.ok(
    profileExports < whiteLabelRequirements,
    'public native identities must be exported from the profile before white-label validation',
  );
  assert.doesNotMatch(verifier, /production-profile\.json/);
  assert.doesNotMatch(verifier, /dist\/xingheyingguan-/);
  assert.doesNotMatch(sdkCheck, /dist\/xingheyingguan-/);
  assert.match(verifier, /outputBaseName/);
  assert.equal(existsSync(resolve(root, 'android-djx-runtime/production-profile.json')), false);

  const productionProfilePath = resolve(
    root,
    'android-djx-runtime/profiles/AG162.json',
  );
  const productionProfile = JSON.parse(readFileSync(productionProfilePath, 'utf8'));
  assert.equal(productionProfile.schemaVersion, 2);
  assert.ok(Number.isSafeInteger(productionProfile.profileVersion));
  assert.equal(productionProfile.profileCode, 'AG162');
  assert.equal(productionProfile.tenantId, productionProfile.profileCode);
});
