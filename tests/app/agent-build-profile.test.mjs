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
  const apkWorkflow = readFileSync(
    resolve(root, '.github/workflows/android-production.yml'),
    'utf8',
  );
  const hotWorkflow = readFileSync(resolve(root, '.github/workflows/hot-update.yml'), 'utf8');
  const apkBuilder = readFileSync(resolve(root, 'android-djx-runtime/build-djx-apk.sh'), 'utf8');
  const verifier = readFileSync(
    resolve(root, 'android-djx-runtime/verify-production-apk.sh'),
    'utf8',
  );
  const sdkCheck = readFileSync(resolve(root, 'android-djx-runtime/check-sdk-config.sh'), 'utf8');
  const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');

  for (const workflow of [apkWorkflow, hotWorkflow]) {
    assert.match(
      workflow,
      /environment:\s*android-production-\$\{\{\s*inputs\.profile_code\s*\}\}/,
    );
    assert.match(workflow, /resolve-build-profile\.mjs/);
    assert.match(workflow, /--profile-code\s+"\$PROFILE_CODE"/);
    assert.match(workflow, /--github-env\s+"\$GITHUB_ENV"/);
  }
  assert.doesNotMatch(apkBuilder, /production-profile\.json/);
  const dependencyInstall = apkWorkflow.indexOf('npm ci');
  const productionBuild = apkWorkflow.indexOf('./android-djx-runtime/build-djx-apk.sh');
  const hotDependencyInstall = hotWorkflow.indexOf('npm ci');
  const hotProductionBuild = hotWorkflow.indexOf('./android-djx-runtime/build-hot-bundle.sh');
  assert.ok(
    dependencyInstall >= 0,
    'production Android packaging must install locked H5 dependencies',
  );
  assert.ok(existsSync(resolve(root, 'package-lock.json')), 'the npm lockfile must be committed');
  assert.doesNotMatch(gitignore, /^package-lock\.json$/m, 'the npm lockfile must not be ignored');
  assert.ok(
    dependencyInstall < productionBuild,
    'locked H5 dependencies must be installed before the production APK build',
  );
  assert.match(
    apkWorkflow,
    /H5_DIR:\s*\$\{\{\s*github\.workspace\s*\}\}\/unpackage\/dist\/build\/h5-android-runtime/,
    'production APK packaging must pin the generated H5 directory on self-hosted runners',
  );
  assert.ok(
    hotDependencyInstall >= 0,
    'production hot updates must install locked H5 dependencies',
  );
  assert.ok(
    hotDependencyInstall < hotProductionBuild,
    'locked H5 dependencies must be installed before the production hot-update build',
  );
  assert.match(apkBuilder, /export SKIT_PROFILE_VERSION="\$PROFILE_VERSION"/);
  assert.match(apkBuilder, /export SKIT_PROFILE_SHA256="\$PROFILE_SHA256"/);
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

  const productionProfilePath = resolve(root, 'android-djx-runtime/profiles/AG162.json');
  const productionProfile = JSON.parse(readFileSync(productionProfilePath, 'utf8'));
  assert.equal(productionProfile.schemaVersion, 2);
  assert.ok(Number.isSafeInteger(productionProfile.profileVersion));
  assert.equal(productionProfile.profileCode, 'AG162');
  assert.equal(productionProfile.tenantId, productionProfile.profileCode);
  assert.equal(productionProfile.profileVersion, 3);
  assert.equal(productionProfile.pangle.adSdkVersion, '7.6.1.1');
  assert.equal(productionProfile.taku.sdkVersion, '6.6.30');
  for (const forbiddenKey of ['networkFirmId', 'networkId', 'adsourceId', 'providerSourceId']) {
    assert.equal(
      Object.hasOwn(productionProfile, forbiddenKey) ||
        Object.hasOwn(productionProfile.taku, forbiddenKey) ||
        Object.hasOwn(productionProfile.pangle, forbiddenKey),
      false,
      `${forbiddenKey} must remain a server-selected runtime value`,
    );
  }
});

test('direct Gradle release packaging fails closed on profile and H5 identity', () => {
  const gradle = readFileSync(resolve(root, 'android-djx-runtime/app/build.gradle'), 'utf8');

  assert.match(
    gradle,
    /def configuredH5Dir = providers\.gradleProperty\('SKIT_H5_DIR'\)\.orNull\s*\?:\s*providers\.environmentVariable\('SKIT_H5_DIR'\)\.orNull/,
    'both a Gradle property and environment variable must be accepted as an explicit H5 input',
  );
  assert.match(gradle, /def validateControlledAgentProfile = \{/);
  assert.match(
    gradle,
    /new File\(profilesDir, "\$\{skitAgentCode\}\.json"\)/,
    'a direct Gradle build must resolve only profiles/<agent>.json',
  );
  assert.match(gradle, /profile\.profileCode != skitAgentCode/);
  assert.match(gradle, /profile\.tenantId != skitAgentCode/);
  assert.match(gradle, /profile\.applicationId != skitApplicationId/);
  assert.match(gradle, /profile\.pangle\.siteId != pangleAppId/);
  assert.match(gradle, /profile\.pangle\.contentSdkVersion != pangleContentSdkVersion/);
  assert.match(gradle, /pangrowth-base:\$\{pangleContentSdkVersion\}/);
  assert.match(gradle, /pangrowth-djx-sdk-lite:\$\{pangleContentSdkVersion\}/);
  assert.match(gradle, /profile\.taku\.appId != takuAppId/);
  assert.match(gradle, /profile\.taku\.rewardPlacementId != takuRewardPlacementId/);
  assert.match(gradle, /sha256FileHex\(profileFile\) != skitProfileSha256/);
  assert.match(gradle, /skitProfileVersion\.matches\('\[1-9\]\[0-9\]\*'\)/);
  assert.match(gradle, /skitProfileSha256\.matches\('\[a-f0-9\]\{64\}'\)/);
  assert.match(gradle, /skitTenantId != skitAgentCode/);

  const releaseValidator = gradle.indexOf("tasks.register('validateSkitReleaseInputs')");
  const releaseTaskHook = gradle.indexOf('def releaseArtifactTaskNames = [');
  assert.ok(releaseValidator >= 0, 'release validation must be an always-run task dependency');
  assert.ok(releaseTaskHook > releaseValidator, 'release tasks must be wired after the validator');
  for (const taskName of [
    'assembleRelease',
    'packageRelease',
    'bundleRelease',
    'packageReleaseBundle',
    'packageReleaseUniversalApk',
    'makeApkFromBundleForRelease',
  ]) {
    assert.match(gradle, new RegExp(`'${taskName}'`));
  }
  assert.match(gradle, /task\.dependsOn validateSkitReleaseInputs/);
  assert.match(
    gradle,
    /task\.doFirst \{\s*validateSkitReleasePackageInputs\(\)/,
    'direct release tasks must also validate immediately before producing the package',
  );
  assert.match(
    gradle,
    /Release build requires an explicit SKIT_H5_DIR Gradle property or environment variable/,
  );
  assert.match(gradle, /Release SKIT_H5_DIR must point to a newly built H5 output/);
  assert.match(gradle, /validateH5ProfileMarker\(sourceRevision\)/);
  assert.match(gradle, /\.skit-h5-build-profile\.json/);
  assert.match(gradle, /sourceRevision/);
  assert.match(gradle, /resolveCleanGitSourceRevision\(\)/);
  assert.match(gradle, /status.*--porcelain.*--untracked-files=normal/);
  assert.match(gradle, /H5 fallback profile does not match the current Git revision/);
});
