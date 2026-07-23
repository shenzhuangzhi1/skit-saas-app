import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const servicePath = resolve(root, 'pages/drama/services/privacy-consent.js');

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}-${Math.random()}`;
}

async function importConsentService() {
  assert.ok(existsSync(servicePath), 'privacy-consent.js must exist');
  const nativeBridgeUrl = sourceUrl(`
    export function getNativePlugin() { return null; }
    export function callNativeMethod() { return Promise.reject(new Error('not injected')); }
  `);
  const source = readFileSync(servicePath, 'utf8').replace(
    "from './native-bridge';",
    `from ${JSON.stringify(nativeBridgeUrl)};`,
  );
  return import(sourceUrl(source));
}

async function importPangleContent({ plugin, ensureConsent }) {
  globalThis.__skitPangleConsentPlugin = plugin;
  globalThis.__skitEnsurePangleConsent = ensureConsent;
  const nativeBridgeUrl = sourceUrl(`
    export function getNativePlugin() { return globalThis.__skitPangleConsentPlugin; }
    export function callNativeMethod(plugin, method, payload) {
      return new Promise((resolve, reject) => {
        try {
          const returned = plugin[method](payload, resolve);
          if (returned && typeof returned.then === 'function') returned.then(resolve).catch(reject);
          else if (returned !== undefined) resolve(returned);
        } catch (error) { reject(error); }
      });
    }
  `);
  const dataUrl = sourceUrl('export function cacheExternalDramas() {}');
  const privacyUrl = sourceUrl(`
    export function ensureAdPrivacyConsent(identity) {
      return globalThis.__skitEnsurePangleConsent(identity);
    }
  `);
  const sheepUrl = sourceUrl(`
    const userStore = { userInfo: {}, adConfig: {}, async getAdConfig() {} };
    export default { $store() { return userStore; } };
  `);
  const displayAdUrl = sourceUrl(`
    export function chinaDate() { return '2026-07-24'; }
    export function resolveDisplayPlacements() {
      return { postCheckInDramaInterstitial: '' };
    }
    export const displayAdFlow = {
      runBeforeDramaPlay(options) { return options.openPlayer(); },
    };
  `);
  const source = readFileSync(resolve(root, 'pages/drama/services/pangle-content.js'), 'utf8')
    .replace("from './native-bridge';", `from ${JSON.stringify(nativeBridgeUrl)};`)
    .replace("from '@/pages/drama/data';", `from ${JSON.stringify(dataUrl)};`)
    .replace("from './privacy-consent';", `from ${JSON.stringify(privacyUrl)};`)
    .replace("from '@/sheep';", `from ${JSON.stringify(sheepUrl)};`)
    .replace(
      "from '@/pages/drama/services/display-ad-flow.mjs';",
      `from ${JSON.stringify(displayAdUrl)};`,
    );
  return import(sourceUrl(source));
}

test('first locked-episode consent is explicit, profile-scoped, persisted, and delivered natively', async () => {
  const { createAdPrivacyConsentGate } = await importConsentService();
  const storage = new Map();
  const prompts = [];
  const deliveries = [];
  const gate = createAdPrivacyConsentGate({
    getStored: (key) => storage.get(key),
    setStored: (key, value) => storage.set(key, value),
    prompt: async (copy) => {
      prompts.push(copy);
      return true;
    },
    deliver: async (granted) => deliveries.push(granted),
    getProfileCode: () => 'AGENT_ALPHA',
    now: () => '2026-07-22T08:00:00.000Z',
  });

  assert.equal(await gate.ensure({ tenantId: 'tenant-a', memberId: 'member-1' }), true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].content, /隐私协议/);
  assert.match(prompts[0].content, /广告 SDK/);
  assert.deepEqual(deliveries, [true]);
  assert.equal(storage.size, 1);
  assert.deepEqual([...storage.values()][0], {
    consentVersion: 1,
    acceptedAt: '2026-07-22T08:00:00.000Z',
  });

  assert.equal(await gate.ensure({ tenantId: 'tenant-a', memberId: 'member-1' }), true);
  assert.equal(prompts.length, 1, 'the accepted profile is not prompted again');
  assert.deepEqual(deliveries, [true], 'one page runtime delivers accepted consent only once');

  assert.equal(await gate.ensure({ tenantId: 'tenant-a', memberId: 'member-2' }), true);
  assert.equal(prompts.length, 1, 'the accepted white-label build profile is not prompted again');
  assert.deepEqual(deliveries, [true]);
  assert.equal(storage.size, 1);
});

test('declining consent performs no native delivery and cannot persist acceptance', async () => {
  const { createAdPrivacyConsentGate } = await importConsentService();
  const writes = [];
  let deliveries = 0;
  const gate = createAdPrivacyConsentGate({
    getStored: () => undefined,
    setStored: (...args) => writes.push(args),
    prompt: async () => false,
    deliver: async () => {
      deliveries += 1;
    },
    getProfileCode: () => 'AGENT_ALPHA',
  });

  assert.equal(await gate.ensure({ tenantId: 'tenant-a', memberId: 'member-1' }), false);
  assert.equal(deliveries, 0);
  assert.deepEqual(writes, []);
});

test('native consent delivery accepts only a caller-supplied boolean', async () => {
  const { deliverAdPrivacyConsent } = await importConsentService();
  await assert.rejects(() => deliverAdPrivacyConsent('true'), /boolean/i);
});

test('same member cannot reuse consent across build profiles and restart re-delivers it', async () => {
  const { createAdPrivacyConsentGate } = await importConsentService();
  const storage = new Map();
  const identity = { tenantId: 'tenant-a', memberId: 'member-1' };
  let prompts = 0;
  let deliveries = 0;
  const options = (profileCode) => ({
    getStored: (key) => storage.get(key),
    setStored: (key, value) => storage.set(key, value),
    prompt: async () => {
      prompts += 1;
      return true;
    },
    deliver: async () => {
      deliveries += 1;
    },
    getProfileCode: () => profileCode,
    now: () => '2026-07-22T08:00:00.000Z',
  });

  await createAdPrivacyConsentGate(options('AGENT_ALPHA')).ensure(identity);
  await createAdPrivacyConsentGate(options('AGENT_BETA')).ensure(identity);
  assert.equal(prompts, 2, 'another white-label build profile needs independent consent');
  assert.equal(storage.size, 2);

  await createAdPrivacyConsentGate(options('AGENT_ALPHA')).ensure(identity);
  assert.equal(prompts, 2, 'persisted acceptance avoids another modal after restart');
  assert.equal(deliveries, 3, 'a restarted page must re-deliver persisted consent to native');
});

test('unlock obtains consent before ownership or server ad-session creation', () => {
  const source = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const unlockStart = source.indexOf('async function unlockCurrent()');
  const consent = source.indexOf('ensureAdPrivacyConsent(identity)', unlockStart);
  const ownership = source.indexOf('acquireAdSessionOwnership', unlockStart);
  const session = source.indexOf('prepareUnlockSession', unlockStart);

  assert.ok(unlockStart >= 0 && consent > unlockStart, 'unlock must request consent');
  assert.ok(consent < ownership, 'consent must precede unlock ownership');
  assert.ok(consent < session, 'consent must precede ad-session creation');
});

test('free direct player obtains consent before the Pangle native launch', () => {
  const source = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const playerStart = source.indexOf('async function playCurrentEpisode(');
  const consent = source.indexOf('ensureAdPrivacyConsent(identity)', playerStart);
  const nativeLaunch = source.indexOf('openPangleDramaPlayer({', playerStart);

  assert.ok(playerStart >= 0 && consent > playerStart, 'content launch must request consent');
  assert.ok(consent < nativeLaunch, 'consent must precede the Pangle direct-player launch');
});

test('content bootstrap maps pre-consent failure, prompts, and retries instead of hanging', () => {
  const source = readFileSync(resolve(root, 'pages/drama/services/pangle-content.js'), 'utf8');
  assert.match(source, /PRIVACY_CONSENT_REQUIRED/);
  assert.match(source, /PANGLE_INIT_FAILED/);
  assert.match(source, /ensureAdPrivacyConsent\s*\(/);
  assert.match(source, /consentAttempted/);
  assert.match(source, /return startPangleContentSdk\s*\(/);
});

test('theatre list before consent prompts once, retries bootstrap, and completes', async () => {
  const calls = [];
  let startCalls = 0;
  const subject = await importPangleContent({
    ensureConsent: async () => {
      calls.push('consent');
      return true;
    },
    plugin: {
      start(_payload, callback) {
        startCalls += 1;
        calls.push(`start-${startCalls}`);
        callback(
          startCalls === 1
            ? { success: false, code: -701, message: 'consent required' }
            : { success: true, started: true },
        );
      },
      list(_payload, callback) {
        calls.push('list');
        callback({
          success: true,
          list: [
            {
              id: 3474,
              title: '真实短剧',
              total: 12,
              freeSet: 2,
              lockSet: 1,
            },
          ],
        });
      },
    },
  });

  const result = await Promise.race([
    subject.getPangleDramaList({ page: 1, pageSize: 20 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('content consent hung')), 100)),
  ]);

  assert.deepEqual(calls, ['start-1', 'consent', 'start-2', 'list']);
  assert.equal(result.list.length, 1);
});
