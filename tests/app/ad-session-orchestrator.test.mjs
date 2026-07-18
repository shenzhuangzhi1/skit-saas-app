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

const subject = await importSource('pages/drama/services/ad-session-orchestrator.js');

function requireSubject() {
  assert.ok(subject, 'ad-session-orchestrator.js must exist');
  return subject;
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      values.set(key, structuredClone(value));
    },
    remove(key) {
      values.delete(key);
    },
    entries() {
      return values;
    },
  };
}

const identityA = { tenantId: 11, memberId: 101 };
const identityB = { tenantId: 12, memberId: 101 };
const identityC = { tenantId: 11, memberId: 202 };
const protocol = {
  outcome: 'CREATED',
  protocolVersion: 1,
  sessionId: 'session_0123456789ABCD',
  provider: 'TAKU',
  placementId: 'tenant-placement-1',
  userId: 'opaque-member-1',
  customData: 'token_0123456789ABCDEFGH',
  scene: 'drama_unlock',
  loadExpiresAt: '2026-07-15T08:05:00',
  rewardAcceptUntil: '2026-07-15T08:20:00',
};

function ok(data) {
  return { code: 0, data };
}

function makeApi(overrides = {}) {
  return {
    createAdSession: async () => ok(protocol),
    getAdSession: async (sessionId) =>
      ok({
        sessionId,
        clientLifecycleStatus: 'CLOSED',
        rewardVerificationStatus: 'PENDING',
        entitlementStatus: 'NONE',
        revenueStatus: 'NONE',
        providerShowId: 'show-1',
        rewardAcceptUntil: protocol.rewardAcceptUntil,
      }),
    recordClientEvents: async (sessionId) =>
      ok({
        sessionId,
        clientLifecycleStatus: 'SHOWN',
        rewardVerificationStatus: 'PENDING',
        entitlementStatus: 'NONE',
        revenueStatus: 'NONE',
      }),
    issuePlayerGrant: async (dramaId) =>
      ok({
        grantId: 88,
        dramaId,
        expiresAt: '2026-07-15T08:05:00',
        grantToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      }),
    getEntitlements: async (dramaId) => ok({ dramaId, grantedEpisodeNos: [3, 4] }),
    ...overrides,
  };
}

test('validates the exact server protocol before native handoff', () => {
  const { validateServerAdProtocol } = requireSubject();
  const normalized = validateServerAdProtocol(protocol);
  assert.deepEqual(normalized, {
    protocolVersion: 1,
    sessionId: protocol.sessionId,
    provider: 'TAKU',
    placementId: protocol.placementId,
    userId: protocol.userId,
    customData: protocol.customData,
    scene: 'drama_unlock',
  });

  for (const patch of [
    { protocolVersion: 2 },
    { sessionId: '' },
    { provider: 'PANGLE' },
    { placementId: '' },
    { userId: '' },
    { customData: '' },
    { scene: 'anything_else' },
  ]) {
    assert.throws(
      () => validateServerAdProtocol({ ...protocol, ...patch }),
      /protocol|会话|TAKU|广告位|用户|令牌|场景/i,
    );
  }
});

test('keys entitlement UI cache by both tenant and member', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const storage = memoryStorage();
  const orchestrator = createAdSessionOrchestrator({ api: makeApi(), storage });

  await orchestrator.refreshEntitlements(identityA, 901);
  assert.deepEqual(
    orchestrator.getCachedEntitlementsForUi(identityA, 901).grantedEpisodeNos,
    [3, 4],
  );
  assert.deepEqual(orchestrator.getCachedEntitlementsForUi(identityB, 901).grantedEpisodeNos, []);
  assert.deepEqual(orchestrator.getCachedEntitlementsForUi(identityC, 901).grantedEpisodeNos, []);
});

test('never treats tampered local entitlement cache as authorization truth', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const storage = memoryStorage();
  let serverEpisodes = [3];
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({
      getEntitlements: async (dramaId) => ok({ dramaId, grantedEpisodeNos: serverEpisodes }),
    }),
    storage,
  });

  await orchestrator.refreshEntitlements(identityA, 901);
  for (const [key, value] of storage.entries()) {
    if (key.includes('entitlement')) {
      storage.set(key, { ...value, grantedEpisodeNos: [3, 99] });
    }
  }
  assert.deepEqual(
    orchestrator.getCachedEntitlementsForUi(identityA, 901).grantedEpisodeNos,
    [3, 99],
  );

  serverEpisodes = [];
  assert.equal(await orchestrator.isAuthoritativelyEntitled(identityA, 901, 99), false);
});

test('persists a pending session under only the current identity', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const storage = memoryStorage();
  const orchestrator = createAdSessionOrchestrator({ api: makeApi(), storage });

  const created = await orchestrator.createSession(identityA, { dramaId: 901, episodeNo: 7 });
  assert.deepEqual(created.nativeProtocol, {
    protocolVersion: 1,
    sessionId: protocol.sessionId,
    provider: 'TAKU',
    placementId: protocol.placementId,
    userId: protocol.userId,
    customData: protocol.customData,
    scene: 'drama_unlock',
  });
  assert.equal(orchestrator.getPendingSessions(identityA).length, 1);
  assert.doesNotMatch(
    JSON.stringify(orchestrator.getPendingSessions(identityA)),
    /customData|token_0123456789ABCDEFGH/,
  );
  assert.equal(orchestrator.getPendingSessions(identityB).length, 0);
  assert.equal(orchestrator.getPendingSessions(identityC).length, 0);
});

test('marks a reused active scope for polling instead of replaying another ad', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({ createAdSession: async () => ok({ ...protocol, outcome: 'REUSED' }) }),
    storage: memoryStorage(),
  });
  const reused = await orchestrator.createSession(identityA, { dramaId: 901, episodeNo: 7 });
  assert.equal(reused.outcome, 'REUSED');
  assert.equal(reused.requiresVerificationPoll, true);
});

test('polls after close with the approved 0.5/1/2/3/3 second schedule', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const waits = [];
  let calls = 0;
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({
      getAdSession: async (sessionId) => {
        calls += 1;
        return ok({
          sessionId,
          clientLifecycleStatus: 'CLOSED',
          rewardVerificationStatus: 'PENDING',
          entitlementStatus: 'NONE',
          revenueStatus: 'NONE',
        });
      },
    }),
    storage: memoryStorage(),
    sleep: async (delay) => waits.push(delay),
  });

  await orchestrator.createSession(identityA, { dramaId: 901, episodeNo: 7 });
  const result = await orchestrator.pollSession(identityA, protocol.sessionId);
  assert.equal(result.resolution, 'VERIFYING');
  assert.deepEqual(waits, [500, 1000, 2000, 3000, 3000]);
  assert.equal(calls, 5);
  assert.equal(orchestrator.getPendingSessions(identityA).length, 1);
});

test('recovers a pending session after interruption and refreshes server entitlements', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const storage = memoryStorage();
  let entitlementCalls = 0;
  const api = makeApi({
    getAdSession: async (sessionId) =>
      ok({
        sessionId,
        clientLifecycleStatus: 'CLOSED',
        rewardVerificationStatus: 'SIGNED_VERIFIED',
        entitlementStatus: 'GRANTED',
        revenueStatus: 'FROZEN',
        providerShowId: 'show-1',
      }),
    getEntitlements: async (dramaId) => {
      entitlementCalls += 1;
      return ok({ dramaId, grantedEpisodeNos: [7, 8] });
    },
  });
  const first = createAdSessionOrchestrator({ api, storage, sleep: async () => {} });
  await first.createSession(identityA, { dramaId: 901, episodeNo: 7 });

  const resumed = createAdSessionOrchestrator({ api, storage, sleep: async () => {} });
  const results = await resumed.recoverPendingSessions(identityA);
  assert.equal(results[0].resolution, 'GRANTED');
  assert.equal(entitlementCalls, 1);
  assert.equal(resumed.getPendingSessions(identityA).length, 0);
  assert.deepEqual(resumed.getCachedEntitlementsForUi(identityA, 901).grantedEpisodeNos, [7, 8]);
});

test('rejects a session status returned for another session', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({
      getAdSession: async () =>
        ok({
          sessionId: 'foreign_0123456789ABCDE',
          clientLifecycleStatus: 'CLOSED',
          rewardVerificationStatus: 'SIGNED_VERIFIED',
          entitlementStatus: 'GRANTED',
          revenueStatus: 'FROZEN',
        }),
    }),
    storage: memoryStorage(),
    sleep: async () => {},
  });
  await orchestrator.createSession(identityA, { dramaId: 901, episodeNo: 7 });
  await assert.rejects(
    () => orchestrator.pollSession(identityA, protocol.sessionId),
    /会话|session/i,
  );
});

test('issues a strict server player grant and rejects invalid identities', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const orchestrator = createAdSessionOrchestrator({ api: makeApi(), storage: memoryStorage() });
  assert.deepEqual(await orchestrator.issuePlayerGrant(identityA, 901), {
    grantId: 88,
    dramaId: 901,
    expiresAt: '2026-07-15T08:05:00',
    grantToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
  });
  await assert.rejects(
    () => orchestrator.issuePlayerGrant({ tenantId: 11 }, 901),
    /identity|会员|member/i,
  );
});

test('records only client telemetry bound to the current server protocol', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  let recorded;
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({
      recordClientEvents: async (sessionId, events) => {
        recorded = { sessionId, events };
        return ok({
          sessionId,
          clientLifecycleStatus: 'LOADING',
          rewardVerificationStatus: 'PENDING',
          entitlementStatus: 'NONE',
          revenueStatus: 'NONE',
        });
      },
    }),
    storage: memoryStorage(),
  });
  const clientEvent = {
    protocolVersion: 1,
    clientEventId: `${protocol.sessionId}:0`,
    callbackSequence: 0,
    sessionId: protocol.sessionId,
    provider: 'TAKU',
    placementId: protocol.placementId,
    eventType: 'LOAD_STARTED',
    nativeState: 'LOADING',
    sdkRequestId: 'request-1',
    providerShowId: null,
    networkFirmId: null,
    adsourceId: null,
    clientRewardObserved: false,
    closed: false,
  };
  await orchestrator.recordClientEvent(identityA, protocol, clientEvent);
  assert.deepEqual(recorded, { sessionId: protocol.sessionId, events: [clientEvent] });
  await assert.rejects(
    () =>
      orchestrator.recordClientEvent(identityA, protocol, {
        ...clientEvent,
        placementId: 'foreign-placement',
      }),
    /广告位|placement/i,
  );
});

test('does not accept a non-success CommonResult as data', async () => {
  const { createAdSessionOrchestrator } = requireSubject();
  const orchestrator = createAdSessionOrchestrator({
    api: makeApi({ createAdSession: async () => ({ code: 400, msg: 'not ready' }) }),
    storage: memoryStorage(),
  });
  await assert.rejects(
    () => orchestrator.createSession(identityA, { dramaId: 901, episodeNo: 7 }),
    /not ready/i,
  );
});
