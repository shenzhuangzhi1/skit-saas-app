import fs from 'node:fs';
import process from 'node:process';

const blockedKey = /(pangle.*(setting|secret|license)|taku.*(secret|key)|private.?key|sign(ing|ature)|password)/i;

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateKeys(value, path = 'profile') {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    assert(!blockedKey.test(key), `${keyPath} may not be stored in release metadata`);
    validateKeys(nested, keyPath);
  }
}

function validateUrl(value) {
  const url = new URL(value);
  assert(url.protocol === 'https:', 'hotBundleUrl must use HTTPS');
  assert(!url.username && !url.password, 'hotBundleUrl may not include credentials');
  assert(!/(^|\.)(localhost|local|internal)$/i.test(url.hostname), 'hotBundleUrl must be publicly reachable');
}

const file = readArgument('--file') || readArgument('--fixture');
assert(file, 'Usage: node script/validate-release-profile.mjs --file profile.json');
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
validateKeys(profile);
assert(/^[A-Z0-9._-]{2,32}$/.test(String(profile.profileCode || '')), 'profileCode is invalid');
assert(/^(production|staging)$/.test(String(profile.channel || '')), 'channel is invalid');
assert(/^\d+(\.\d+){1,3}([-.][A-Za-z0-9._-]+)?$/.test(String(profile.hotVersion || '')), 'hotVersion is invalid');
assert(/^[a-f0-9]{64}$/i.test(String(profile.hotBundleSha256 || '')), 'hotBundleSha256 must be SHA-256');
assert(/^\d+(\.\d+){1,3}$/.test(String(profile.minNativeVersion || '')), 'minNativeVersion is invalid');
validateUrl(String(profile.hotBundleUrl || ''));
console.log(`release profile ${profile.profileCode} is valid`);
