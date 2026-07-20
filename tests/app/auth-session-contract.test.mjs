import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const profileDirectory = resolve(root, 'android-djx-runtime/profiles');
const selectedProfileFile = readdirSync(profileDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort()[0];
const selectedProfileRaw = readFileSync(join(profileDirectory, selectedProfileFile), 'utf8');
const selectedProfile = JSON.parse(selectedProfileRaw);
const selectedProfileSha256 = createHash('sha256').update(selectedProfileRaw).digest('hex');

function runH5Build(t, profileEnvironment = {}) {
  const controlledBuildRoot = resolve(root, 'unpackage/dist/build');
  mkdirSync(controlledBuildRoot, { recursive: true });
  const temporaryRoot = mkdtempSync(join(controlledBuildRoot, 'skit-h5-profile-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const hbuilderDir = join(temporaryRoot, 'hbuilderx');
  const uniCli = join(hbuilderDir, 'node_modules/.bin/uni');
  const outputDir = join(temporaryRoot, 'output');
  mkdirSync(dirname(uniCli), { recursive: true });
  writeFileSync(
    uniCli,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'mkdir -p "$UNI_OUTPUT_DIR/assets"',
      'printf \'<html><body><div id="app"></div></body></html>\\n\' > "$UNI_OUTPUT_DIR/index.html"',
      'printf \'const agent="%s";mount("#app");\\n\' "$VITE_SKIT_AGENT_CODE" > "$UNI_OUTPUT_DIR/assets/pages-auth-index.fake.js"',
    ].join('\n'),
  );
  chmodSync(uniCli, 0o755);
  const result = spawnSync('bash', [resolve(root, 'android-djx-runtime/build-h5.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HBUILDERX_DIR: hbuilderDir,
      HX_APP_ROOT: temporaryRoot,
      H5_DIR: outputDir,
      SKIT_AGENT_CODE: selectedProfile.profileCode,
      SKIT_PROFILE_VERSION: String(selectedProfile.profileVersion),
      SKIT_PROFILE_SHA256: selectedProfileSha256,
      SKIT_API_BASE_URL: 'https://alpha.example.test',
      ...profileEnvironment,
    },
  });
  return { outputDir, result };
}

test('transport-level 401 responses enter the member token refresh flow', () => {
  const request = read('sheep/request/index.js');

  assert.match(
    request,
    /case 401:[\s\S]*?return refreshToken\(error\.config\);/,
    'an HTTP 401 must use the same refresh, logout and login redirect flow as a business 401',
  );
});

test('Android H5 packaging binds the generated fallback to the selected dynamic profile', (t) => {
  const h5Builder = read('android-djx-runtime/build-h5.sh');
  const apkBuilder = read('android-djx-runtime/build-djx-apk.sh');
  const gradle = read('android-djx-runtime/app/build.gradle');
  const { outputDir, result } = runH5Build(t);

  assert.equal(result.status, 0, result.stderr);
  const marker = JSON.parse(
    readFileSync(join(outputDir, '.skit-h5-build-profile.json'), 'utf8'),
  );
  assert.deepEqual(marker, {
    agentCode: selectedProfile.profileCode,
    profileVersion: selectedProfile.profileVersion,
    profileSha256: selectedProfileSha256,
    apiBaseUrlSha256: createHash('sha256')
      .update('https://alpha.example.test')
      .digest('hex'),
  });
  assert.match(h5Builder, /SKIT_AGENT_CODE is required for Android H5 builds/);
  assert.match(h5Builder, /SKIT_PROFILE_VERSION/);
  assert.match(h5Builder, /SKIT_PROFILE_SHA256/);
  assert.match(apkBuilder, /export SKIT_PROFILE_VERSION="\$PROFILE_VERSION"/);
  assert.match(apkBuilder, /export SKIT_PROFILE_SHA256="\$PROFILE_SHA256"/);
  assert.match(
    apkBuilder,
    /"\$H5_DIR" == "\$DEFAULT_H5_DIR"[^\n]*SKIP_UNI_BUILD/,
    'a custom prebuilt H5 directory must not be destructively rebuilt in place',
  );
  const safetyCheck = h5Builder.indexOf('BUILD_OUTPUT_ROOT=');
  const destructiveReplace = h5Builder.indexOf('rm -rf -- "$OUTPUT_DIR"');
  assert.ok(safetyCheck >= 0, 'the H5 builder must define a controlled output root');
  assert.ok(
    destructiveReplace > safetyCheck,
    'the controlled output check must run before replacing generated files',
  );
  assert.match(gradle, /def skitAgentCode = configValue\('SKIT_AGENT_CODE', ''\)/);
  assert.match(gradle, /SKIT_PROFILE_VERSION/);
  assert.match(gradle, /SKIT_PROFILE_SHA256/);
  assert.match(gradle, /apiBaseUrlSha256/);
  assert.match(
    gradle,
    /inputs\.property\('skitApiBaseUrlSha256',\s*sha256Hex\(apiBaseUrl\)\)/,
    'changing only the selected API endpoint must invalidate cached H5 asset preparation',
  );
  assert.match(gradle, /H5 fallback profile does not match SKIT_AGENT_CODE/);
  assert.doesNotMatch(
    h5Builder,
    /SKIT_AGENT_CODE=['"]AG[0-9]+/,
    'the packaging contract must not hardcode one agent',
  );
});

test('Android H5 builder rejects paths outside its controlled output root without deleting them', (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'skit-h5-unsafe-path-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const sentinel = join(temporaryRoot, 'keep-me.txt');
  writeFileSync(sentinel, 'preserve');

  const result = spawnSync('bash', [resolve(root, 'android-djx-runtime/build-h5.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      H5_DIR: temporaryRoot,
      SKIT_AGENT_CODE: selectedProfile.profileCode,
      SKIT_API_BASE_URL: 'https://alpha.example.test',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /controlled build root/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
});

test('Android H5 packaging derives canonical metadata for shared hot-update builds', (t) => {
  const { outputDir, result } = runH5Build(t, {
    SKIT_PROFILE_VERSION: '',
    SKIT_PROFILE_SHA256: '',
  });

  assert.equal(result.status, 0, result.stderr);
  const marker = JSON.parse(
    readFileSync(join(outputDir, '.skit-h5-build-profile.json'), 'utf8'),
  );
  assert.equal(marker.profileVersion, selectedProfile.profileVersion);
  assert.equal(marker.profileSha256, selectedProfileSha256);
});

test('Android H5 packaging rejects conflicting dynamic profile metadata', (t) => {
  const { result } = runH5Build(t, { SKIT_PROFILE_SHA256: 'b'.repeat(64) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SKIT_PROFILE_SHA256.*conflicts/);
});

test('Android packages for a non-local API reject an empty Taku AppKey', () => {
  const gradle = read('android-djx-runtime/app/build.gradle');

  assert.match(gradle, /def localApiEndpoint = apiBaseUrl == 'http:\/\/127\.0\.0\.1:48080'/);
  assert.match(gradle, /if \(!localApiEndpoint && takuAppKey\.isEmpty\(\)\)/);
  assert.match(gradle, /Android builds for non-local APIs require SKIT_TAKU_APP_KEY/);
});
