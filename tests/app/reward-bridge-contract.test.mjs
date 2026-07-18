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

const bridge = await importSource('pages/drama/services/native-bridge.js');
const serverProtocol = {
  protocolVersion: 1,
  sessionId: 'session_0123456789ABCD',
  provider: 'TAKU',
  placementId: 'tenant-placement-1',
  userId: 'opaque-member-1',
  customData: 'token_0123456789ABCDEFGH',
  scene: 'drama_unlock',
};

function requireBridge() {
  assert.ok(bridge?.createNativeTelemetryValidator, 'strict native telemetry validator must exist');
  return bridge;
}

function event(overrides = {}) {
  return {
    protocolVersion: 1,
    sessionId: serverProtocol.sessionId,
    provider: 'TAKU',
    placementId: serverProtocol.placementId,
    sdkRequestId: 'request-1',
    providerShowId: null,
    networkFirmId: null,
    adsourceId: null,
    callbackSequence: 0,
    nativeState: 'LOADING',
    clientRewardObserved: false,
    closed: false,
    ...overrides,
  };
}

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString(
    'base64',
  )}#${Date.now()}-${Math.random()}`;
}

async function importTakuSource() {
  const nativeUrl = sourceUrl(
    readFileSync(resolve(root, 'pages/drama/services/native-bridge.js'), 'utf8'),
  );
  const takuSource = readFileSync(
    resolve(root, 'pages/drama/services/taku-reward-ad.js'),
    'utf8',
  ).replace("from './native-bridge';", `from ${JSON.stringify(nativeUrl)};`);
  return import(sourceUrl(takuSource));
}

test('accepts only the monotonic TAKU native state sequence', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  assert.equal(validator.accept(event()).nativeState, 'LOADING');
  assert.equal(
    validator.accept(event({ callbackSequence: 1, nativeState: 'LOADED' })).nativeState,
    'LOADED',
  );
  assert.equal(
    validator.accept(
      event({
        callbackSequence: 2,
        nativeState: 'SHOWING',
        providerShowId: 'show-1',
        networkFirmId: 66,
        adsourceId: 'source-1',
      }),
    ).nativeState,
    'SHOWING',
  );
  assert.equal(
    validator.accept(
      event({
        callbackSequence: 3,
        nativeState: 'SHOWING',
        providerShowId: 'show-1',
        networkFirmId: 66,
        adsourceId: 'source-1',
        clientRewardObserved: true,
      }),
    ).clientRewardObserved,
    true,
  );
  assert.equal(
    validator.accept(
      event({
        callbackSequence: 4,
        nativeState: 'CLOSED',
        providerShowId: 'show-1',
        networkFirmId: 66,
        adsourceId: 'source-1',
        clientRewardObserved: true,
        closed: true,
      }),
    ).closed,
    true,
  );
});

test('rejects permissive reward aliases instead of inferring success', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  for (const alias of [
    { type: 'complete' },
    { event: 'rewarded' },
    { status: 'success' },
    { completed: true },
    { rewarded: true },
    { isReward: true },
  ]) {
    assert.throws(() => validator.accept(alias), /protocol|字段|会话|native/i);
  }
});

test('rejects missing session or provider show identity', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  assert.throws(
    () => createNativeTelemetryValidator(serverProtocol).accept(event({ sessionId: '' })),
    /会话|session/i,
  );

  const validator = createNativeTelemetryValidator(serverProtocol);
  validator.accept(event());
  validator.accept(event({ callbackSequence: 1, nativeState: 'LOADED' }));
  assert.throws(
    () => validator.accept(event({ callbackSequence: 2, nativeState: 'SHOWING' })),
    /show|展示/i,
  );
});

test('rejects wrong placement, provider, and protocol version', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  for (const patch of [
    { placementId: 'foreign-placement' },
    { provider: 'PANGLE' },
    { protocolVersion: 2 },
  ]) {
    assert.throws(
      () => createNativeTelemetryValidator(serverProtocol).accept(event(patch)),
      /广告位|TAKU|protocol|版本/i,
    );
  }
});

test('rejects nonmonotonic callbacks and provider show changes', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  validator.accept(event());
  assert.throws(() => validator.accept(event()), /sequence|序号|单调/i);

  const second = createNativeTelemetryValidator(serverProtocol);
  second.accept(event());
  second.accept(event({ callbackSequence: 1, nativeState: 'LOADED' }));
  second.accept(
    event({
      callbackSequence: 2,
      nativeState: 'SHOWING',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
    }),
  );
  assert.throws(
    () =>
      second.accept(
        event({
          callbackSequence: 3,
          nativeState: 'SHOWING',
          providerShowId: 'show-2',
          networkFirmId: 66,
          adsourceId: 'source-1',
          clientRewardObserved: true,
        }),
      ),
    /show|展示/i,
  );
});

test('rejects readiness belonging to another session', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  validator.accept(event());
  assert.throws(
    () =>
      validator.accept(
        event({
          callbackSequence: 1,
          nativeState: 'LOADED',
          sessionId: 'foreign_0123456789ABCDE',
        }),
      ),
    /会话|session/i,
  );
});

test('emits a backend-valid failure event even after a reward observation', () => {
  const { createNativeTelemetryValidator, nativeTelemetryToClientEvent } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  validator.accept(event());
  validator.accept(event({ callbackSequence: 1, nativeState: 'LOADED' }));
  validator.accept(
    event({
      callbackSequence: 2,
      nativeState: 'SHOWING',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
    }),
  );
  validator.accept(
    event({
      callbackSequence: 3,
      nativeState: 'SHOWING',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      clientRewardObserved: true,
    }),
  );
  const failure = validator.accept(
    event({
      callbackSequence: 4,
      nativeState: 'ERROR',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      clientRewardObserved: false,
    }),
  );
  assert.equal(nativeTelemetryToClientEvent(failure).eventType, 'FAILED');
  assert.equal(nativeTelemetryToClientEvent(failure).clientRewardObserved, false);
});

test('Taku bridge forwards only the server protocol and streams backend client events', async () => {
  const originalUni = globalThis.uni;
  let nativePayload;
  const callbacks = [
    event(),
    event({ callbackSequence: 1, nativeState: 'LOADED' }),
    event({
      callbackSequence: 2,
      nativeState: 'SHOWING',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
    }),
    event({
      callbackSequence: 3,
      nativeState: 'SHOWING',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      clientRewardObserved: true,
    }),
    event({
      callbackSequence: 4,
      nativeState: 'CLOSED',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      clientRewardObserved: true,
      closed: true,
    }),
  ];
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(payload, callback) {
          nativePayload = payload;
          queueMicrotask(() => callbacks.forEach(callback));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const clientEvents = [];
    await taku.showRewardedVideoAd(serverProtocol, {
      onClientEvent: async (clientEvent) => clientEvents.push(clientEvent.eventType),
      timeoutMs: 100,
    });
    assert.deepEqual(nativePayload, serverProtocol);
    assert.deepEqual(clientEvents, ['LOAD_STARTED', 'SHOWN', 'REWARD_OBSERVED', 'CLOSED']);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge fails immediately when backend telemetry delivery fails', async () => {
  const originalUni = globalThis.uni;
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callback(event()));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    await assert.rejects(
      () =>
        taku.showRewardedVideoAd(serverProtocol, {
          onClientEvent: async () => {
            throw new Error('telemetry failed');
          },
          timeoutMs: 100,
        }),
      /telemetry failed/,
    );
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge has no success path when the native plugin is absent', async () => {
  const originalUni = globalThis.uni;
  globalThis.uni = { requireNativePlugin: () => null };
  try {
    const taku = await importTakuSource();
    await assert.rejects(() => taku.showRewardedVideoAd(serverProtocol), /激励视频暂不可用/);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('maps strict native states to backend telemetry without granting locally', () => {
  const { nativeTelemetryToClientEvent } = requireBridge();
  assert.equal(nativeTelemetryToClientEvent(event()).eventType, 'LOAD_STARTED');
  assert.equal(
    nativeTelemetryToClientEvent(
      event({ callbackSequence: 1, nativeState: 'SHOWING', providerShowId: 'show-1' }),
    ).eventType,
    'SHOWN',
  );
  assert.equal(
    nativeTelemetryToClientEvent(
      event({
        callbackSequence: 2,
        nativeState: 'SHOWING',
        providerShowId: 'show-1',
        clientRewardObserved: true,
      }),
    ).eventType,
    'REWARD_OBSERVED',
  );
  assert.equal(
    nativeTelemetryToClientEvent(
      event({
        callbackSequence: 3,
        nativeState: 'CLOSED',
        providerShowId: 'show-1',
        closed: true,
      }),
    ).eventType,
    'CLOSED',
  );
  assert.equal(nativeTelemetryToClientEvent(event({ nativeState: 'LOADED' })), null);
});

test('repository contains no GroMore route, reward fallback, or client-side authorization write', () => {
  const rewardSource = readFileSync(resolve(root, 'pages/drama/services/reward-ad.js'), 'utf8');
  const takuSource = readFileSync(resolve(root, 'pages/drama/services/taku-reward-ad.js'), 'utf8');
  const playSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const dataSource = readFileSync(resolve(root, 'pages/drama/data.js'), 'utf8');
  const legacyRevenueSource = readFileSync(resolve(root, 'sheep/api/member/ad-revenue.js'), 'utf8');
  const contentSource = readFileSync(
    resolve(root, 'pages/drama/services/pangle-content.js'),
    'utf8',
  );
  const previewSource = readFileSync(
    resolve(root, 'android-preview-webview/preview-runtime.js'),
    'utf8',
  );

  assert.equal(existsSync(resolve(root, 'pages/drama/services/gromore-reward-ad.js')), false);
  assert.doesNotMatch(rewardSource, /gromore|GroMore|\bcsj\b|provider\s*===\s*['"]pangle/i);
  assert.doesNotMatch(takuSource, /showMock|MOCK_REWARD|fallback|type\s*===\s*['"]complete/i);
  assert.doesNotMatch(playSource, /unlockEpisodes|AdRevenueApi|grossAmount|\becpm\b/i);
  assert.doesNotMatch(dataSource, /UNLOCK_KEY|unlockEpisodes/i);
  assert.doesNotMatch(legacyRevenueSource, /grossAmount|completed|\becpm\b|externalEventId/i);
  assert.match(contentSource, /playerGrant/);
  assert.match(contentSource, /uni\.navigateTo/);
  assert.doesNotMatch(
    previewSource,
    /completed\s*:\s*true|rewarded\s*:\s*true|SkitGroMoreAd|showRewardAd/,
  );
});

test('authenticated ad-session and entitlement API modules expose every approved endpoint', () => {
  const sessionSource = readFileSync(resolve(root, 'sheep/api/member/ad-session.js'), 'utf8');
  const entitlementSource = readFileSync(resolve(root, 'sheep/api/member/entitlement.js'), 'utf8');
  for (const endpoint of [
    '/skit/member/player-grants',
    '/skit/member/ad-sessions',
    '/client-events',
  ]) {
    assert.match(sessionSource, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.match(entitlementSource, /\/skit\/member\/entitlements/);
  assert.match(sessionSource, /auth:\s*true/);
  assert.match(entitlementSource, /auth:\s*true/);
});

test('App foreground resumes the identity-scoped pending verification queue', () => {
  const appSource = readFileSync(resolve(root, 'App.vue'), 'utf8');
  const playSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const runtimePath = resolve(root, 'pages/drama/services/ad-session-runtime.js');
  assert.equal(existsSync(runtimePath), true);
  assert.match(appSource, /recoverPendingAdSessions/);
  assert.match(appSource, /onShow/);
  assert.match(playSource, /watch\(\s*\(\) => \[\s*userStore\.userInfo\?\.tenantId/);
});
