import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

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

function eventWithFailureReason(overrides, failureReason) {
  const value = event(overrides);
  Object.defineProperty(value, 'failureReason', {
    value: failureReason,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
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
      clientRewardObserved: true,
    }),
  );
  assert.equal(nativeTelemetryToClientEvent(failure).eventType, 'FAILED');
  assert.equal(nativeTelemetryToClientEvent(failure).clientRewardObserved, true);
});

test('rejects fabricated or regressed reward evidence on a failure event', () => {
  const { createNativeTelemetryValidator } = requireBridge();
  assert.throws(
    () =>
      createNativeTelemetryValidator(serverProtocol).accept(
        event({
          nativeState: 'ERROR',
          providerShowId: 'show-1',
          networkFirmId: 66,
          adsourceId: 'source-1',
          clientRewardObserved: true,
        }),
      ),
    /奖励观察状态|展示回调|展示证据/i,
  );
  assert.throws(
    () =>
      createNativeTelemetryValidator(serverProtocol).accept(
        event({
          nativeState: 'ERROR',
          providerShowId: 'show-1',
          networkFirmId: 66,
          adsourceId: 'source-1',
        }),
      ),
    /展示证据/i,
  );

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
  assert.throws(
    () =>
      validator.accept(
        event({
          callbackSequence: 4,
          nativeState: 'ERROR',
          providerShowId: 'show-1',
          networkFirmId: 66,
          adsourceId: 'source-1',
          clientRewardObserved: false,
        }),
      ),
    /奖励观察状态/i,
  );
});

test('post-show failure cannot omit the bound show identity', () => {
  const { createNativeTelemetryValidator } = requireBridge();
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

  assert.throws(
    () => validator.accept(event({ callbackSequence: 3, nativeState: 'ERROR' })),
    /展示证据/i,
  );
});

test('post-reward failure requires the complete original show identity', () => {
  const { createNativeTelemetryValidator } = requireBridge();
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

  assert.throws(
    () =>
      validator.accept(
        event({
          callbackSequence: 4,
          nativeState: 'ERROR',
          clientRewardObserved: true,
        }),
      ),
    /show|广告源证据/i,
  );
});

test('maps safe no-fill telemetry to a UI-only reason without widening backend events', () => {
  const { createNativeTelemetryValidator, nativeTelemetryToClientEvent } = requireBridge();
  const validator = createNativeTelemetryValidator(serverProtocol);
  validator.accept(event());
  const noFill = validator.accept(
    eventWithFailureReason({ callbackSequence: 1, nativeState: 'ERROR' }, 'NO_FILL'),
  );
  assert.equal(noFill.failureReason, 'NO_FILL');
  const clientEvent = nativeTelemetryToClientEvent(noFill);
  assert.equal(clientEvent.eventType, 'FAILED');
  assert.equal(Object.hasOwn(clientEvent, 'failureReason'), false);

  assert.throws(
    () =>
      createNativeTelemetryValidator(serverProtocol).accept(
        eventWithFailureReason({ nativeState: 'ERROR' }, 'Return Ad is empty.'),
      ),
    /failure|失败|原因/i,
  );
  assert.throws(
    () =>
      createNativeTelemetryValidator(serverProtocol).accept(
        eventWithFailureReason({ nativeState: 'LOADING' }, 'NO_FILL'),
      ),
    /failure|失败|原因/i,
  );
});

test('Taku bridge exposes no-fill as a structured error after recording FAILED', async () => {
  const originalUni = globalThis.uni;
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => {
            callback(event());
            callback(
              eventWithFailureReason({ callbackSequence: 1, nativeState: 'ERROR' }, 'NO_FILL'),
            );
          });
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const clientEvents = [];
    await assert.rejects(
      () =>
        taku.showRewardedVideoAd(serverProtocol, {
          onClientEvent: async (clientEvent) => clientEvents.push(clientEvent),
          timeoutMs: 100,
        }),
      (error) => error?.code === 'NATIVE_AD_NO_FILL' && !!error?.terminalTelemetry,
    );
    assert.deepEqual(
      clientEvents.map((clientEvent) => clientEvent.eventType),
      ['LOAD_STARTED', 'FAILED'],
    );
    assert.equal(
      clientEvents.some((clientEvent) => 'failureReason' in clientEvent),
      false,
    );
  } finally {
    globalThis.uni = originalUni;
  }
});

test('a shown rewarded ad survives the loading timeout until its native terminal callback', async () => {
  const originalUni = globalThis.uni;
  let emitTelemetry;
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          emitTelemetry = callback;
          callback(event());
          callback(event({ callbackSequence: 1, nativeState: 'LOADED' }));
          callback(
            event({
              callbackSequence: 2,
              nativeState: 'SHOWING',
              providerShowId: 'show-after-background',
              networkFirmId: 66,
              adsourceId: 'source-1',
            }),
          );
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const clientEvents = [];
    let settledBeforeNativeTerminal = false;
    const resultPromise = taku
      .showRewardedVideoAd(serverProtocol, {
        onClientEvent: async (clientEvent) => clientEvents.push(clientEvent),
        timeoutMs: 30,
        telemetryRetryDelaysMs: [],
      })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        settledBeforeNativeTerminal = true;
      });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    assert.equal(
      settledBeforeNativeTerminal,
      false,
      'SHOWING and REWARD_OBSERVED are non-terminal until native CLOSED or ERROR',
    );
    emitTelemetry(
      event({
        callbackSequence: 3,
        nativeState: 'SHOWING',
        providerShowId: 'show-after-background',
        networkFirmId: 66,
        adsourceId: 'source-1',
        clientRewardObserved: true,
      }),
    );
    emitTelemetry(
      event({
        callbackSequence: 4,
        nativeState: 'CLOSED',
        providerShowId: 'show-after-background',
        networkFirmId: 66,
        adsourceId: 'source-1',
        clientRewardObserved: true,
        closed: true,
      }),
    );

    const result = await resultPromise;
    assert.equal(result.error, undefined);
    assert.equal(result.value?.outcome, 'REWARD_OBSERVED');
    assert.deepEqual(
      clientEvents.map((clientEvent) => clientEvent.eventType),
      ['LOAD_STARTED', 'SHOWN', 'REWARD_OBSERVED', 'CLOSED'],
    );
  } finally {
    globalThis.uni = originalUni;
  }
});

test('a rewarded ad that never reaches SHOWING still fails at the loading timeout', async () => {
  const originalUni = globalThis.uni;
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          callback(event());
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    await assert.rejects(
      () =>
        taku.showRewardedVideoAd(serverProtocol, {
          timeoutMs: 20,
          telemetryRetryDelaysMs: [],
        }),
      (error) => error?.code === 'NATIVE_AD_TIMEOUT',
    );
  } finally {
    globalThis.uni = originalUni;
  }
});

test('maps bounded bootstrap failure hints to stable H5 errors without widening telemetry', async () => {
  const originalUni = globalThis.uni;
  const mappings = [
    ['PRIVACY_CONSENT_REQUIRED', 'PRIVACY_CONSENT_REQUIRED'],
    ['PANGLE_INIT_FAILED', 'PANGLE_INIT_FAILED'],
    ['TAKU_INIT_FAILED', 'TAKU_INIT_FAILED'],
  ];
  try {
    for (const [failureReason, expectedCode] of mappings) {
      globalThis.uni = {
        requireNativePlugin() {
          return {
            showRewardedVideo(_payload, callback) {
              queueMicrotask(() =>
                callback(eventWithFailureReason({ nativeState: 'ERROR' }, failureReason)),
              );
            },
          };
        },
      };
      const taku = await importTakuSource();
      const clientEvents = [];
      await assert.rejects(
        () =>
          taku.showRewardedVideoAd(serverProtocol, {
            onClientEvent: async (clientEvent) => clientEvents.push(clientEvent),
            timeoutMs: 100,
          }),
        (error) => error?.code === expectedCode && !!error?.terminalTelemetry,
      );
      assert.equal(clientEvents.length, 1);
      assert.equal(clientEvents[0].eventType, 'FAILED');
      assert.equal(Object.hasOwn(clientEvents[0], 'failureReason'), false);
    }
  } finally {
    globalThis.uni = originalUni;
  }
});

test('runtime failure hints remain non-enumerable and callback-scoped', () => {
  const runtime = readFileSync(resolve(root, 'android-djx-runtime/djx-runtime.js'), 'utf8');
  assert.match(runtime, /__SkitNativeBridgeFailureHint/);
  assert.match(runtime, /Object\.defineProperty\(result,\s*['"]failureReason['"]/);
  assert.match(runtime, /enumerable:\s*false/);
  assert.match(runtime, /delete failureHints\[id\]/);
});

test('runtime behavior keeps the 11-field callback compatible and never leaks hints across calls', () => {
  const posts = [];
  const runtimeWindow = {
    uni: { requireNativePlugin: () => null },
    SkitNativeBridge: {
      postMessage(rawMessage) {
        posts.push(JSON.parse(rawMessage));
      },
    },
  };
  const runtimeSource = readFileSync(resolve(root, 'android-djx-runtime/djx-runtime.js'), 'utf8');
  runInNewContext(runtimeSource, {
    window: runtimeWindow,
    document: { readyState: 'complete', addEventListener() {} },
    setInterval() {
      return 1;
    },
    console: { log() {} },
  });
  const plugin = runtimeWindow.uni.requireNativePlugin('SkitTakuAd');
  let firstResult;
  plugin.showRewardedVideo({}, (result) => {
    firstResult = result;
  });
  const firstId = posts[0].id;
  runtimeWindow.__SkitNativeBridgeFailureHint(firstId, 'NO_FILL');
  const rawError = event({ nativeState: 'ERROR' });
  runtimeWindow.__SkitNativeBridgeEmit(firstId, JSON.stringify(rawError), true);

  assert.deepEqual(Object.keys(firstResult), Object.keys(rawError));
  assert.equal(firstResult.failureReason, 'NO_FILL');
  assert.equal(Object.getOwnPropertyDescriptor(firstResult, 'failureReason')?.enumerable, false);

  runtimeWindow.__SkitNativeBridgeFailureHint(firstId, 'NO_FILL');
  let secondResult;
  plugin.showRewardedVideo({}, (result) => {
    secondResult = result;
  });
  const secondId = posts[1].id;
  runtimeWindow.__SkitNativeBridgeFailureHint(secondId, 'Return Ad is empty.');
  runtimeWindow.__SkitNativeBridgeEmit(secondId, JSON.stringify(rawError), true);
  assert.equal(Object.prototype.hasOwnProperty.call(secondResult, 'failureReason'), false);

  for (const reason of ['PRIVACY_CONSENT_REQUIRED', 'PANGLE_INIT_FAILED', 'TAKU_INIT_FAILED']) {
    let result;
    plugin.showRewardedVideo({}, (value) => {
      result = value;
    });
    const id = posts.at(-1).id;
    runtimeWindow.__SkitNativeBridgeFailureHint(id, reason);
    runtimeWindow.__SkitNativeBridgeEmit(id, JSON.stringify(rawError), true);
    assert.equal(result.failureReason, reason);
    assert.equal(Object.getOwnPropertyDescriptor(result, 'failureReason')?.enumerable, false);
  }
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

test('Taku bridge reports an early close as incomplete instead of reward verification', async () => {
  const originalUni = globalThis.uni;
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
      nativeState: 'CLOSED',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      closed: true,
    }),
  ];
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callbacks.forEach(callback));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const result = await taku.showRewardedVideoAd(serverProtocol, {
      onClientEvent: async () => {},
      timeoutMs: 100,
    });
    assert.equal(result.outcome, 'INCOMPLETE');
    assert.equal(result.rewardObserved, false);
    assert.equal(result.terminalTelemetry.nativeState, 'CLOSED');
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge retries one failed telemetry POST in order and still completes reward playback', async () => {
  const originalUni = globalThis.uni;
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
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callbacks.forEach(callback));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const attempts = [];
    let loadAttempts = 0;
    const result = await taku.showRewardedVideoAd(serverProtocol, {
      onClientEvent: async (clientEvent) => {
        attempts.push(clientEvent.eventType);
        if (clientEvent.eventType === 'LOAD_STARTED' && loadAttempts++ === 0) {
          throw new Error('first POST failed');
        }
      },
      telemetryRetryDelaysMs: [0, 0],
      timeoutMs: 100,
    });
    assert.equal(result.outcome, 'REWARD_OBSERVED');
    assert.deepEqual(attempts, [
      'LOAD_STARTED',
      'LOAD_STARTED',
      'SHOWN',
      'REWARD_OBSERVED',
      'CLOSED',
    ]);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge still delivers FAILED reward evidence when REWARD_OBSERVED delivery fails', async () => {
  const originalUni = globalThis.uni;
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
      nativeState: 'ERROR',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      clientRewardObserved: true,
    }),
  ];
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callbacks.forEach(callback));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const attempts = [];
    await assert.rejects(
      () =>
        taku.showRewardedVideoAd(serverProtocol, {
          onClientEvent: async (clientEvent) => {
            attempts.push({
              eventType: clientEvent.eventType,
              clientRewardObserved: clientEvent.clientRewardObserved,
            });
            if (clientEvent.eventType === 'REWARD_OBSERVED') {
              throw new Error('reward POST failed');
            }
          },
          telemetryRetryDelaysMs: [],
          timeoutMs: 100,
        }),
      (error) => error?.code === 'TELEMETRY_DELIVERY_FAILED',
    );
    assert.deepEqual(attempts, [
      { eventType: 'LOAD_STARTED', clientRewardObserved: false },
      { eventType: 'SHOWN', clientRewardObserved: false },
      { eventType: 'REWARD_OBSERVED', clientRewardObserved: true },
      { eventType: 'FAILED', clientRewardObserved: true },
    ]);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge returns a structured delivery error when telemetry cannot reach the backend', async () => {
  const originalUni = globalThis.uni;
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
      nativeState: 'CLOSED',
      providerShowId: 'show-1',
      networkFirmId: 66,
      adsourceId: 'source-1',
      closed: true,
    }),
  ];
  globalThis.uni = {
    requireNativePlugin() {
      return {
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callbacks.forEach(callback));
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const attempts = [];
    await assert.rejects(
      () =>
        taku.showRewardedVideoAd(serverProtocol, {
          onClientEvent: async (clientEvent) => {
            attempts.push(clientEvent.eventType);
            if (clientEvent.eventType === 'LOAD_STARTED') {
              throw new taku.AdFlowError('UPSTREAM_EVENT_POST_FAILED', 'telemetry failed');
            }
          },
          telemetryRetryDelaysMs: [0, 0],
          timeoutMs: 100,
        }),
      (error) =>
        error?.code === 'TELEMETRY_DELIVERY_FAILED' &&
        error?.terminalTelemetry?.nativeState === 'CLOSED' &&
        /telemetry failed/.test(error.message),
    );
    assert.deepEqual(attempts, ['LOAD_STARTED', 'LOAD_STARTED', 'LOAD_STARTED', 'SHOWN', 'CLOSED']);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('DJX callback handles are not mistaken for rewarded telemetry', async () => {
  const originalUni = globalThis.uni;
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
        showRewardedVideo(_payload, callback) {
          queueMicrotask(() => callbacks.forEach(callback));
          return 'djx_opaque_callback_handle';
        },
      };
    },
  };
  try {
    const taku = await importTakuSource();
    const clientEvents = [];
    const result = await taku.showRewardedVideoAd(serverProtocol, {
      onClientEvent(clientEvent) {
        clientEvents.push(clientEvent.eventType);
      },
      timeoutMs: 100,
    });

    assert.equal(result.outcome, 'REWARD_OBSERVED');
    assert.deepEqual(clientEvents, ['LOAD_STARTED', 'SHOWN', 'REWARD_OBSERVED', 'CLOSED']);
  } finally {
    globalThis.uni = originalUni;
  }
});

test('Taku bridge has no success path when the native plugin is absent', async () => {
  const originalUni = globalThis.uni;
  globalThis.uni = { requireNativePlugin: () => null };
  try {
    const taku = await importTakuSource();
    await assert.rejects(
      () => taku.showRewardedVideoAd(serverProtocol),
      (error) => error?.code === 'NATIVE_AD_UNAVAILABLE' && /激励视频暂不可用/.test(error.message),
    );
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

test('App foreground resumes pending verification through scope and session singleflight', () => {
  const appSource = readFileSync(resolve(root, 'App.vue'), 'utf8');
  const playSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const runtimePath = resolve(root, 'pages/drama/services/ad-session-runtime.js');
  const runtimeSource = readFileSync(runtimePath, 'utf8');
  assert.equal(existsSync(runtimePath), true);
  assert.match(appSource, /recoverPendingAdSessions/);
  assert.match(appSource, /onShow/);
  assert.match(playSource, /watch\(\s*\(\) => \[\s*userStore\.userInfo\?\.tenantId/);
  assert.match(runtimeSource, /createAdSessionRecoveryCoordinator/);
  assert.match(runtimeSource, /export function acquireAdSessionOwnership/);
  assert.match(runtimeSource, /adSessionOrchestrator\.getPendingSessions/);
  assert.match(
    runtimeSource,
    /recoveryCoordinator[\s\S]*?\.runRecovery\([\s\S]*?session\.sessionId/,
  );
  assert.match(runtimeSource, /options\.onResult/);
  assert.match(appSource, /onResult/);
  assert.match(playSource, /onResult/);
});
