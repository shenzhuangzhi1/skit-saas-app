#!/usr/bin/env node

import { appendFileSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const defaultProfilesDir = resolve(runtimeDir, 'profiles');
const profileCodePattern = /^[A-Z0-9_-]{3,32}$/;
const androidPackagePattern = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const providerIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { profilesDir: defaultProfilesDir, format: 'summary' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${name}`);
    }
    if (name === '--profile-code') options.profileCode = value;
    else if (name === '--profiles-dir') options.profilesDir = resolve(value);
    else if (name === '--format') options.format = value;
    else if (name === '--github-env') options.githubEnv = resolve(value);
    else if (name === '--github-output') options.githubOutput = resolve(value);
    else fail(`Unknown argument ${name}`);
    index += 1;
  }
  if (!options.profileCode) fail('--profile-code is required');
  if (!['json', 'summary'].includes(options.format)) fail('--format must be json or summary');
  return options;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exactly: ${expected.join(', ')}`);
  }
}

function assertString(value, label, { max = 128, pattern } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} contains invalid characters or is too long`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} has an invalid format`);
}

function validateProfile(profile, requestedCode) {
  assertExactKeys(
    profile,
    [
      'schemaVersion',
      'profileVersion',
      'profileCode',
      'tenantId',
      'profileId',
      'applicationId',
      'appName',
      'adProvider',
      'pangle',
      'taku',
      'outputBaseName',
    ],
    'profile',
  );
  if (profile.schemaVersion !== 2) fail('schemaVersion must be 2');
  if (!Number.isSafeInteger(profile.profileVersion) || profile.profileVersion < 1) {
    fail('profileVersion must be a positive safe integer');
  }
  assertString(profile.profileCode, 'profileCode', { pattern: profileCodePattern });
  if (profile.profileCode !== requestedCode) {
    fail(`profileCode must equal requested profile code ${requestedCode}`);
  }
  assertString(profile.tenantId, 'tenantId', { pattern: profileCodePattern });
  if (profile.tenantId !== profile.profileCode) {
    fail('tenantId must equal profileCode for an agent-scoped build');
  }
  assertString(profile.profileId, 'profileId', { pattern: providerIdPattern });
  assertString(profile.applicationId, 'applicationId', {
    max: 200,
    pattern: androidPackagePattern,
  });
  assertString(profile.appName, 'appName', { max: 64 });
  if (profile.adProvider !== 'pangle' && profile.adProvider !== 'taku') {
    fail('adProvider must be pangle or taku');
  }
  assertExactKeys(
    profile.pangle,
    [
      'siteId',
      'contentAppId',
      'settingsAsset',
      'settingsSource',
      'adSdkVersion',
      'contentSdkVersion',
    ],
    'pangle',
  );
  assertString(profile.pangle.siteId, 'pangle.siteId', { pattern: providerIdPattern });
  assertString(profile.pangle.contentAppId, 'pangle.contentAppId', {
    pattern: providerIdPattern,
  });
  assertString(profile.pangle.settingsAsset, 'pangle.settingsAsset', {
    pattern: /^SDK_Setting(?:_[0-9]+)?\.json$/,
  });
  assertString(profile.pangle.settingsSource, 'pangle.settingsSource', { max: 300 });
  if (
    isAbsolute(profile.pangle.settingsSource) ||
    profile.pangle.settingsSource.includes('\\') ||
    profile.pangle.settingsSource.split('/').some((part) => part === '..' || part === '')
  ) {
    fail('pangle.settingsSource must be a safe repository-relative path');
  }
  assertString(profile.pangle.adSdkVersion, 'pangle.adSdkVersion', {
    pattern: versionPattern,
  });
  assertString(profile.pangle.contentSdkVersion, 'pangle.contentSdkVersion', {
    pattern: versionPattern,
  });
  assertExactKeys(
    profile.taku,
    ['appId', 'rewardPlacementId', 'sdkVersion'],
    'taku',
  );
  assertString(profile.taku.appId, 'taku.appId', { pattern: providerIdPattern });
  assertString(profile.taku.rewardPlacementId, 'taku.rewardPlacementId', {
    pattern: providerIdPattern,
  });
  assertString(profile.taku.sdkVersion, 'taku.sdkVersion', { pattern: versionPattern });
  assertString(profile.outputBaseName, 'outputBaseName', {
    max: 80,
    pattern: /^[a-z0-9][a-z0-9._-]*$/,
  });
}

function loadProfile(profilesDir, profileCode) {
  const profilePath = resolve(profilesDir, `${profileCode}.json`);
  if (dirname(profilePath) !== profilesDir) fail('profile path escapes the profiles directory');
  if (lstatSync(profilePath).isSymbolicLink()) fail('profile file must not be a symbolic link');
  const canonicalProfilePath = realpathSync(profilePath);
  if (dirname(canonicalProfilePath) !== profilesDir) {
    fail('profile path escapes the profiles directory');
  }
  const raw = readFileSync(canonicalProfilePath, 'utf8');
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    fail(`${profileCode} profile must contain valid JSON`);
  }
  validateProfile(profile, profileCode);
  return { profile, profilePath: canonicalProfilePath, raw };
}

function assertUniqueProfiles(profiles) {
  const uniqueIdentities = [
    ['tenantId', (profile) => profile.tenantId],
    ['profileId', (profile) => profile.profileId],
    ['applicationId', (profile) => profile.applicationId],
    ['pangle.siteId', (profile) => profile.pangle.siteId],
    ['pangle.contentAppId', (profile) => profile.pangle.contentAppId],
    ['pangle.settingsSource', (profile) => profile.pangle.settingsSource],
    ['taku.appId', (profile) => profile.taku.appId],
    ['taku.rewardPlacementId', (profile) => profile.taku.rewardPlacementId],
    ['outputBaseName', (profile) => profile.outputBaseName],
  ];
  for (const [label, readIdentity] of uniqueIdentities) {
    const owners = new Map();
    for (const profile of profiles) {
      const identity = readIdentity(profile);
      const existingOwner = owners.get(identity);
      if (existingOwner) {
        fail(`${label} ${identity} is reused by ${existingOwner} and ${profile.profileCode}`);
      }
      owners.set(identity, profile.profileCode);
    }
  }
}

function resolveProfile(options) {
  if (!profileCodePattern.test(options.profileCode)) {
    fail('profile code must be a canonical uppercase profile code');
  }
  const profilesDir = realpathSync(options.profilesDir);
  const profileCodes = readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.json'))
    .map((entry) => {
      if (!entry.isFile()) fail(`${entry.name} must be a regular profile file`);
      return entry.name.slice(0, -'.json'.length);
    })
    .sort();
  if (!profileCodes.includes(options.profileCode)) {
    fail(`No controlled profile exists for ${options.profileCode}`);
  }
  const loadedProfiles = profileCodes.map((profileCode) => loadProfile(profilesDir, profileCode));
  assertUniqueProfiles(loadedProfiles.map(({ profile }) => profile));
  const selected = loadedProfiles.find(({ profile }) => profile.profileCode === options.profileCode);
  const { profile, profilePath, raw } = selected;
  return {
    profilePath,
    profileSha256: createHash('sha256').update(raw).digest('hex'),
    profileCode: profile.profileCode,
    profileVersion: profile.profileVersion,
    tenantId: profile.tenantId,
    profileId: profile.profileId,
    applicationId: profile.applicationId,
    appName: profile.appName,
    adProvider: profile.adProvider,
    pangleSiteId: profile.pangle.siteId,
    pangleContentAppId: profile.pangle.contentAppId,
    pangleSettingsAsset: profile.pangle.settingsAsset,
    pangleSettingsSource: profile.pangle.settingsSource,
    pangleAdSdkVersion: profile.pangle.adSdkVersion,
    pangleContentSdkVersion: profile.pangle.contentSdkVersion,
    takuAppId: profile.taku.appId,
    takuRewardPlacementId: profile.taku.rewardPlacementId,
    takuSdkVersion: profile.taku.sdkVersion,
    outputBaseName: profile.outputBaseName,
  };
}

function appendEnvironment(path, profile) {
  const values = {
    SKIT_PROFILE_CODE: profile.profileCode,
    SKIT_PROFILE_VERSION: String(profile.profileVersion),
    SKIT_PROFILE_SHA256: profile.profileSha256,
    SKIT_PRODUCTION_PROFILE: profile.profilePath,
    SKIT_AGENT_CODE: profile.profileCode,
    SKIT_TENANT_ID: profile.tenantId,
    SKIT_APPLICATION_ID: profile.applicationId,
    SKIT_APP_NAME: profile.appName,
    SKIT_DRAMA_AD_PROVIDER: profile.adProvider,
    SKIT_PANGLE_APP_ID: profile.pangleSiteId,
    SKIT_TAKU_APP_ID: profile.takuAppId,
    SKIT_TAKU_REWARD_PLACEMENT_ID: profile.takuRewardPlacementId,
    SKIT_OUTPUT_BASE_NAME: profile.outputBaseName,
  };
  appendFileSync(path, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

function appendOutputs(path, profile) {
  appendFileSync(
    path,
    [
      `profile_code=${profile.profileCode}`,
      `profile_version=${profile.profileVersion}`,
      `profile_sha256=${profile.profileSha256}`,
      `output_base_name=${profile.outputBaseName}`,
    ].join('\n') + '\n',
  );
}

try {
  const options = parseArguments(process.argv.slice(2));
  const profile = resolveProfile(options);
  if (options.githubEnv) appendEnvironment(options.githubEnv, profile);
  if (options.githubOutput) appendOutputs(options.githubOutput, profile);
  if (options.format === 'json') process.stdout.write(`${JSON.stringify(profile)}\n`);
  else {
    process.stdout.write(
      `profile=${profile.profileCode} version=${profile.profileVersion} sha256=${profile.profileSha256}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`Android build profile error: ${error.message}\n`);
  process.exitCode = 1;
}
