#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const defaultManifest = resolve(runtimeDir, 'taku-adapter-bundle.lock.json');
const defaultBundleDir = resolve(runtimeDir, 'app/libs/taku');
const defaultKeepFile = resolve(runtimeDir, 'app/src/main/res/raw/keep.xml');
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

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    manifest: defaultManifest,
    bundleDir: defaultBundleDir,
    keepFile: defaultKeepFile,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${name}`);
    if (name === '--mode') options.mode = value;
    else if (name === '--manifest') options.manifest = resolve(value);
    else if (name === '--bundle-dir') options.bundleDir = resolve(value);
    else if (name === '--keep-file') options.keepFile = resolve(value);
    else if (name === '--apk') options.apk = resolve(value);
    else if (name === '--aapt') options.aapt = resolve(value);
    else fail(`Unknown argument ${name}`);
    index += 1;
  }
  if (!['source', 'apk'].includes(options.mode)) fail('--mode must be source or apk');
  if (options.mode === 'apk' && !options.apk) fail('--apk is required for APK mode');
  return options;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readJson(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read locked manifest ${path}: ${error.message}`);
  }
  return value;
}

function inspectIdentityNeutral(value) {
  if (Array.isArray(value)) {
    value.forEach(inspectIdentityNeutral);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenIdentityKeys.has(key.toLowerCase())) {
      fail(`locked manifest contains runtime identity key ${key}`);
    }
    inspectIdentityNeutral(child);
  }
}

function sortedUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) {
    fail(`${label} must be an array of non-empty strings`);
  }
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
  return [...values].sort();
}

function validateLock(lock) {
  if (!lock || lock.schemaVersion !== 1) fail('unsupported locked manifest schema');
  if (!/^[0-9]{14}$/.test(lock.bundleVersion || '')) fail('invalid bundleVersion');
  if (!/^[a-f0-9]{64}$/.test(lock.officialZipSha256 || '')) {
    fail('invalid official ZIP checksum');
  }
  if (!lock.keepXml
      || lock.keepXml.path !== 'app/src/main/res/raw/keep.xml'
      || !/^[a-f0-9]{64}$/.test(lock.keepXml.sha256 || '')) {
    fail('invalid official keep.xml lock');
  }
  if (!Array.isArray(lock.artifacts) || lock.artifacts.length !== 13) {
    fail('locked manifest must contain exactly 13 AAR artifacts');
  }
  inspectIdentityNeutral(lock);
  const files = new Set();
  for (const artifact of lock.artifacts) {
    if (!artifact || !/^[A-Za-z0-9._-]+\.aar$/.test(artifact.file || '')) {
      fail('artifact file must be a plain AAR filename');
    }
    if (files.has(artifact.file)) fail(`duplicate artifact ${artifact.file}`);
    files.add(artifact.file);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
      fail(`invalid checksum for ${artifact.file}`);
    }
    if (!Array.isArray(artifact.jarEntries) || artifact.jarEntries.length === 0) {
      fail(`${artifact.file} must lock every nested jar`);
    }
    const jarPaths = new Set();
    for (const jar of artifact.jarEntries) {
      if (!jar || typeof jar.path !== 'string' || !jar.path.endsWith('.jar')) {
        fail(`${artifact.file} contains an invalid jar entry`);
      }
      if (jarPaths.has(jar.path)) fail(`${artifact.file} repeats jar ${jar.path}`);
      jarPaths.add(jar.path);
      if (!/^[a-f0-9]{64}$/.test(jar.sha256 || '')) {
        fail(`${artifact.file} contains an invalid jar checksum for ${jar.path}`);
      }
    }
    for (const field of [
      'classMarkers',
      'dexMarkers',
      'manifestMarkers',
      'resourceMarkers',
      'nativeLibraries',
    ]) {
      sortedUniqueStrings(artifact[field], `${artifact.file}.${field}`);
    }
  }
  sortedUniqueStrings(lock.forbiddenMergedPermissions, 'forbiddenMergedPermissions');
  sortedUniqueStrings(lock.mergedComponentMarkers, 'mergedComponentMarkers');
  sortedUniqueStrings(lock.mergedResourceMarkers, 'mergedResourceMarkers');
  sortedUniqueStrings(lock.apkClassMarkers, 'apkClassMarkers');
  return lock;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) fail(`${basename(command)} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr || '';
    fail(`${basename(command)} failed: ${stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function listZip(path) {
  return String(run('unzip', ['-Z1', path]))
    .split(/\r?\n/u)
    .filter(Boolean);
}

function readZipEntry(path, entry) {
  return run('unzip', ['-p', path, entry], { binary: true });
}

function readUleb128(buffer, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (let index = 0; index < 5; index += 1) {
    if (offset >= buffer.length) fail('truncated DEX ULEB128 value');
    const byte = buffer[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  fail('invalid DEX ULEB128 value');
}

function parseDexClassDefinitions(buffer, label) {
  if (buffer.length < 112 || buffer.subarray(0, 4).toString('ascii') !== 'dex\n') {
    fail(`${label} is not a DEX file`);
  }
  const stringIdsSize = buffer.readUInt32LE(56);
  const stringIdsOffset = buffer.readUInt32LE(60);
  const typeIdsSize = buffer.readUInt32LE(64);
  const typeIdsOffset = buffer.readUInt32LE(68);
  const classDefsSize = buffer.readUInt32LE(96);
  const classDefsOffset = buffer.readUInt32LE(100);
  if (stringIdsOffset + stringIdsSize * 4 > buffer.length
      || typeIdsOffset + typeIdsSize * 4 > buffer.length
      || classDefsOffset + classDefsSize * 32 > buffer.length) {
    fail(`${label} has invalid DEX table bounds`);
  }
  const readString = (index) => {
    if (index >= stringIdsSize) fail(`${label} has an invalid DEX string index`);
    const dataOffset = buffer.readUInt32LE(stringIdsOffset + index * 4);
    const { offset } = readUleb128(buffer, dataOffset);
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) end += 1;
    if (end === buffer.length) fail(`${label} has an unterminated DEX string`);
    return buffer.subarray(offset, end).toString('utf8');
  };
  const classes = [];
  for (let index = 0; index < classDefsSize; index += 1) {
    const classIndex = buffer.readUInt32LE(classDefsOffset + index * 32);
    if (classIndex >= typeIdsSize) fail(`${label} has an invalid DEX class index`);
    const descriptorIndex = buffer.readUInt32LE(typeIdsOffset + classIndex * 4);
    classes.push(readString(descriptorIndex));
  }
  return classes;
}

function classPathToDescriptor(path) {
  return `L${path.slice(0, -'.class'.length)};`;
}

function addClass(classOwners, descriptor, owner) {
  const previous = classOwners.get(descriptor);
  if (previous) fail(`duplicate class ${descriptor} in ${previous} and ${owner}`);
  classOwners.set(descriptor, owner);
}

function inspectJarBuffer(buffer, label, tempDir) {
  const jarPath = resolve(tempDir, `${sha256(Buffer.from(label)).slice(0, 24)}.jar`);
  writeFileSync(jarPath, buffer);
  const entries = listZip(jarPath);
  const classes = entries.filter((entry) => entry.endsWith('.class'));
  const dexClasses = [];
  for (const entry of entries.filter((name) => /(^|\/)classes[0-9]*\.dex$/u.test(name))) {
    const dex = readZipEntry(jarPath, entry);
    dexClasses.push(...parseDexClassDefinitions(dex, `${label}!${entry}`));
  }
  return { entries, classes, dexClasses };
}

function assertExact(actual, expected, label) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    fail(`${label} mismatch; actual=${left.join(',')} expected=${right.join(',')}`);
  }
}

function verifySource(lock, bundleDir, keepFile) {
  if (!statSync(bundleDir).isDirectory()) fail(`bundle directory is missing: ${bundleDir}`);
  const keepDigest = sha256(readFileSync(keepFile));
  if (keepDigest !== lock.keepXml.sha256) {
    fail(`keep.xml checksum mismatch: ${keepDigest}`);
  }
  const actualAars = readdirSync(bundleDir)
    .filter((name) => name.endsWith('.aar'))
    .sort();
  const expectedAars = lock.artifacts.map(({ file }) => file).sort();
  assertExact(actualAars, expectedAars, 'official AAR filenames');

  const classOwners = new Map();
  const tempDir = mkdtempSync(resolve(tmpdir(), 'skit-taku-bundle-'));
  try {
    for (const artifact of lock.artifacts) {
      const aarPath = resolve(bundleDir, artifact.file);
      const aar = readFileSync(aarPath);
      const digest = sha256(aar);
      if (digest !== artifact.sha256) {
        fail(`${artifact.file} checksum mismatch: ${digest}`);
      }
      const entries = listZip(aarPath);
      const actualJarPaths = entries.filter((entry) => entry.endsWith('.jar'));
      const expectedJarPaths = artifact.jarEntries.map(({ path }) => path);
      assertExact(actualJarPaths, expectedJarPaths, `${artifact.file} nested jars`);

      const artifactClasses = new Set();
      const artifactDexClasses = new Set();
      for (const lockedJar of artifact.jarEntries) {
        const jar = readZipEntry(aarPath, lockedJar.path);
        const jarDigest = sha256(jar);
        if (jarDigest !== lockedJar.sha256) {
          fail(`${artifact.file}!${lockedJar.path} checksum mismatch: ${jarDigest}`);
        }
        const inspected = inspectJarBuffer(
          jar,
          `${artifact.file}!${lockedJar.path}`,
          tempDir,
        );
        for (const classPath of inspected.classes) {
          artifactClasses.add(classPath);
          addClass(
            classOwners,
            classPathToDescriptor(classPath),
            `${artifact.file}!${lockedJar.path}`,
          );
        }
        for (const descriptor of inspected.dexClasses) {
          artifactDexClasses.add(descriptor);
          addClass(classOwners, descriptor, `${artifact.file}!${lockedJar.path}!classes.dex`);
        }
      }
      for (const marker of artifact.classMarkers) {
        if (!artifactClasses.has(marker)) fail(`${artifact.file} is missing class marker ${marker}`);
      }
      for (const marker of artifact.dexMarkers) {
        if (!artifactDexClasses.has(marker)) fail(`${artifact.file} is missing DEX marker ${marker}`);
      }

      const manifest = readZipEntry(aarPath, 'AndroidManifest.xml').toString('utf8');
      for (const marker of artifact.manifestMarkers) {
        if (!manifest.includes(marker)) {
          fail(`${artifact.file} is missing manifest component ${marker}`);
        }
      }
      for (const marker of artifact.resourceMarkers) {
        if (!entries.includes(marker)) fail(`${artifact.file} is missing resource ${marker}`);
      }
      const nativeLibraries = entries.filter((entry) => /^jni\/.+\.so$/u.test(entry));
      assertExact(nativeLibraries, artifact.nativeLibraries, `${artifact.file} native libraries`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  const ttAdSdk = 'Lcom/bytedance/sdk/openadsdk/TTAdSdk;';
  if (!classOwners.has(ttAdSdk)) fail('TTAdSdk is missing from the official bundle');
  process.stdout.write(
    `Taku adapter source bundle verified: artifacts=${lock.artifacts.length} classes=${classOwners.size} TTAdSdk=1\n`,
  );
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findAapt(explicit) {
  if (explicit) {
    if (!executable(explicit)) fail(`aapt is not executable: ${explicit}`);
    return explicit;
  }
  if (process.env.AAPT && executable(process.env.AAPT)) return process.env.AAPT;
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidHome) fail('ANDROID_HOME or ANDROID_SDK_ROOT is required for APK mode');
  const buildTools = resolve(androidHome, 'build-tools');
  const candidates = readdirSync(buildTools)
    .map((version) => resolve(buildTools, version, 'aapt'))
    .filter(executable)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (candidates.length === 0) fail(`aapt not found under ${buildTools}`);
  return candidates.at(-1);
}

function verifyPackagedAssetJars(lock, apk, entries, tempDir) {
  for (const artifact of lock.artifacts) {
    for (const jar of artifact.jarEntries.filter(({ path }) => path.startsWith('assets/'))) {
      if (!entries.includes(jar.path)) fail(`APK is missing locked asset jar ${jar.path}`);
      const packaged = readZipEntry(apk, jar.path);
      if (sha256(packaged) !== jar.sha256) {
        fail(`APK asset jar ${jar.path} checksum mismatch`);
      }
      if (artifact.dexMarkers.length > 0) {
        const inspected = inspectJarBuffer(packaged, `APK!${jar.path}`, tempDir);
        for (const marker of artifact.dexMarkers) {
          if (!inspected.dexClasses.includes(marker)) {
            fail(`APK asset jar ${jar.path} is missing DEX marker ${marker}`);
          }
        }
      }
    }
  }
}

function verifyApk(lock, apk, explicitAapt) {
  if (!statSync(apk).isFile()) fail(`APK is missing: ${apk}`);
  const entries = listZip(apk);
  const dexEntries = entries.filter((entry) => /^classes[0-9]*\.dex$/u.test(entry));
  if (dexEntries.length === 0) fail('APK contains no DEX files');
  const classOwners = new Map();
  for (const dexEntry of dexEntries) {
    const dex = readZipEntry(apk, dexEntry);
    for (const descriptor of parseDexClassDefinitions(dex, `APK!${dexEntry}`)) {
      addClass(classOwners, descriptor, dexEntry);
    }
  }
  for (const marker of lock.apkClassMarkers) {
    if (!classOwners.has(marker)) fail(`APK is missing class marker ${marker}`);
  }
  const ttAdSdk = 'Lcom/bytedance/sdk/openadsdk/TTAdSdk;';
  const ttOwner = classOwners.get(ttAdSdk);
  if (!ttOwner) fail('APK is missing TTAdSdk');

  const expectedNativeLibraries = new Set();
  for (const artifact of lock.artifacts) {
    for (const nativeLibrary of artifact.nativeLibraries) {
      expectedNativeLibraries.add(nativeLibrary.replace(/^jni\//u, 'lib/'));
    }
  }
  for (const nativeLibrary of expectedNativeLibraries) {
    if (!entries.includes(nativeLibrary)) fail(`APK is missing native library ${nativeLibrary}`);
  }

  const tempDir = mkdtempSync(resolve(tmpdir(), 'skit-taku-apk-'));
  try {
    verifyPackagedAssetJars(lock, apk, entries, tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const aapt = findAapt(explicitAapt);
  const manifestTree = String(run(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml']));
  for (const component of lock.mergedComponentMarkers) {
    if (!manifestTree.includes(component)) fail(`APK manifest is missing component ${component}`);
  }
  const permissions = String(run(aapt, ['dump', 'permissions', apk]));
  for (const permission of lock.forbiddenMergedPermissions) {
    if (permissions.includes(permission)) fail(`APK contains forbidden permission ${permission}`);
  }
  const resources = String(run(aapt, ['dump', 'resources', apk]));
  for (const marker of lock.mergedResourceMarkers) {
    if (!resources.includes(marker)) fail(`APK resources are missing ${marker}`);
  }
  process.stdout.write(
    `Taku adapter APK bundle verified: dex=${dexEntries.length} classes=${classOwners.size} TTAdSdk=1 assetJars=3\n`,
  );
}

try {
  const options = parseArguments(process.argv.slice(2));
  const lock = validateLock(readJson(options.manifest));
  if (options.mode === 'source') verifySource(lock, options.bundleDir, options.keepFile);
  else verifyApk(lock, options.apk, options.aapt);
} catch (error) {
  process.stderr.write(`Taku adapter bundle verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
