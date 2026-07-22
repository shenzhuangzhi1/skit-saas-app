export function getNativePlugin(pluginName) {
  try {
    if (typeof uni === 'undefined' || typeof uni.requireNativePlugin !== 'function') {
      return null;
    }
    return uni.requireNativePlugin(pluginName);
  } catch (error) {
    return null;
  }
}

const PROTOCOL_VERSION = 1;
const PROVIDER = 'TAKU';
const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SAFE_TEXT_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,256}$/;
const NATIVE_FIELDS = new Set([
  'protocolVersion',
  'sessionId',
  'provider',
  'placementId',
  'sdkRequestId',
  'providerShowId',
  'networkFirmId',
  'adsourceId',
  'callbackSequence',
  'nativeState',
  'clientRewardObserved',
  'closed',
]);
const NATIVE_STATES = new Set(['LOADING', 'LOADED', 'SHOWING', 'CLOSED', 'ERROR']);
const ERROR_FAILURE_REASONS = new Set([
  'NO_FILL',
  'SDK_FAILURE',
  'PRIVACY_CONSENT_REQUIRED',
  'PANGLE_INIT_FAILED',
  'TAKU_INIT_FAILED',
]);

function requireSafeText(value, label) {
  const text = String(value ?? '');
  if (!SAFE_TEXT_PATTERN.test(text)) {
    throw new Error(`${label}格式错误`);
  }
  return text;
}

export function validateNativeServerProtocol(value) {
  if (value?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('原生广告 protocol 版本不受支持');
  }
  if (!SESSION_PATTERN.test(String(value?.sessionId ?? ''))) {
    throw new Error('原生广告会话编号格式错误');
  }
  if (value?.provider !== PROVIDER) {
    throw new Error('原生广告仅支持 TAKU');
  }
  const placementId = requireSafeText(value?.placementId, '原生广告位');
  const userId = requireSafeText(value?.userId, '原生用户标识');
  const customData = String(value?.customData ?? '');
  if (!TOKEN_PATTERN.test(customData)) {
    throw new Error('原生会话令牌格式错误');
  }
  if (value?.scene !== 'drama_unlock') {
    throw new Error('原生广告场景不受支持');
  }
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: value.sessionId,
    provider: PROVIDER,
    placementId,
    userId,
    customData,
    scene: 'drama_unlock',
  });
}

function assertExactNativeFields(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('原生广告回调字段格式错误');
  }
  const keys = Object.keys(value);
  if (keys.length !== NATIVE_FIELDS.size || keys.some((key) => !NATIVE_FIELDS.has(key))) {
    throw new Error('原生广告回调字段不符合严格 protocol');
  }
}

function normalizeNativeTelemetry(value, protocol) {
  assertExactNativeFields(value);
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('原生广告 protocol 版本错误');
  }
  if (value.sessionId !== protocol.sessionId) {
    throw new Error('原生广告会话 session 不匹配');
  }
  if (value.provider !== PROVIDER) {
    throw new Error('原生广告 provider 必须是 TAKU');
  }
  if (value.placementId !== protocol.placementId) {
    throw new Error('原生广告位 placement 不匹配');
  }
  const sdkRequestId = requireSafeText(value.sdkRequestId, 'SDK 请求编号');
  if (!Number.isSafeInteger(value.callbackSequence) || value.callbackSequence < 0) {
    throw new Error('原生 callbackSequence 序号格式错误');
  }
  if (!NATIVE_STATES.has(value.nativeState)) {
    throw new Error('原生 nativeState 不受支持');
  }
  const failureDescriptor = Object.getOwnPropertyDescriptor(value, 'failureReason');
  if (
    failureDescriptor &&
    (failureDescriptor.enumerable ||
      failureDescriptor.configurable ||
      failureDescriptor.writable ||
      !Object.prototype.hasOwnProperty.call(failureDescriptor, 'value'))
  ) {
    throw new Error('原生失败原因与 nativeState 不一致');
  }
  const hintedFailureReason = failureDescriptor?.value;
  if (value.nativeState !== 'ERROR' && failureDescriptor) {
    throw new Error('原生失败原因与 nativeState 不一致');
  }
  const failureReason =
    value.nativeState === 'ERROR' ? hintedFailureReason || 'SDK_FAILURE' : 'NONE';
  if (value.nativeState === 'ERROR' && !ERROR_FAILURE_REASONS.has(failureReason)) {
    throw new Error('原生失败原因不受支持');
  }
  if (typeof value.clientRewardObserved !== 'boolean' || typeof value.closed !== 'boolean') {
    throw new Error('原生奖励和关闭标记必须是布尔值');
  }
  if ((value.nativeState === 'CLOSED') !== value.closed) {
    throw new Error('原生关闭标记与 nativeState 不一致');
  }
  const showRequired =
    value.nativeState === 'SHOWING' ||
    value.nativeState === 'CLOSED' ||
    (value.nativeState === 'ERROR' && value.clientRewardObserved);
  const showIdentityAllowed =
    showRequired || (value.nativeState === 'ERROR' && value.providerShowId !== null);
  let providerShowId = null;
  if (showIdentityAllowed) {
    providerShowId = requireSafeText(value.providerShowId, '平台展示 show 编号');
  } else if (value.providerShowId !== null) {
    throw new Error('广告展示前不得伪造 providerShowId');
  }
  let networkFirmId = null;
  if (value.networkFirmId !== null) {
    if (!Number.isSafeInteger(value.networkFirmId) || value.networkFirmId <= 0) {
      throw new Error('广告网络编号格式错误');
    }
    networkFirmId = value.networkFirmId;
  }
  let adsourceId = null;
  if (value.adsourceId !== null) {
    adsourceId = requireSafeText(value.adsourceId, '广告源编号');
  }
  if (!showIdentityAllowed && (networkFirmId !== null || adsourceId !== null)) {
    throw new Error('广告展示前不得携带广告源证据');
  }
  if (showIdentityAllowed && (networkFirmId === null || adsourceId === null)) {
    throw new Error('平台展示回调必须携带完整广告源证据');
  }
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: protocol.sessionId,
    provider: PROVIDER,
    placementId: protocol.placementId,
    sdkRequestId,
    providerShowId,
    networkFirmId,
    adsourceId,
    callbackSequence: value.callbackSequence,
    nativeState: value.nativeState,
    failureReason,
    clientRewardObserved: value.clientRewardObserved,
    closed: value.closed,
  });
}

function allowedTransition(previous, next) {
  if (previous === null) {
    return next === 'LOADING' || next === 'ERROR';
  }
  if (previous === 'LOADING') {
    return next === 'LOADED' || next === 'ERROR';
  }
  if (previous === 'LOADED') {
    return next === 'SHOWING' || next === 'ERROR';
  }
  if (previous === 'SHOWING') {
    return next === 'SHOWING' || next === 'CLOSED' || next === 'ERROR';
  }
  return false;
}

export function createNativeTelemetryValidator(serverProtocol) {
  const protocol = validateNativeServerProtocol(serverProtocol);
  let previousState = null;
  let lastSequence = -1;
  let sdkRequestId = null;
  let providerShowId = null;
  let rewardObserved = false;
  let showingSeen = false;
  let terminal = false;

  return Object.freeze({
    accept(rawValue) {
      if (terminal) {
        throw new Error('原生广告会话已经结束');
      }
      const value = normalizeNativeTelemetry(rawValue, protocol);
      if (value.callbackSequence <= lastSequence) {
        throw new Error('callbackSequence 必须单调递增');
      }
      if (!allowedTransition(previousState, value.nativeState)) {
        throw new Error(
          `原生 nativeState 非法跳转: ${previousState || 'START'} -> ${value.nativeState}`,
        );
      }
      if (sdkRequestId !== null && value.sdkRequestId !== sdkRequestId) {
        throw new Error('同一广告会话的 SDK 请求编号发生变化');
      }
      if (
        providerShowId !== null &&
        value.providerShowId !== null &&
        value.providerShowId !== providerShowId
      ) {
        throw new Error('同一广告会话的 provider show 编号发生变化');
      }
      if (
        (value.nativeState === 'LOADING' || value.nativeState === 'LOADED') &&
        value.clientRewardObserved
      ) {
        throw new Error('广告展示前不能观察到奖励');
      }
      if (value.nativeState === 'SHOWING') {
        if (!showingSeen && value.clientRewardObserved) {
          throw new Error('奖励回调不能早于展示回调');
        }
        if (showingSeen && !rewardObserved && !value.clientRewardObserved) {
          throw new Error('重复展示回调不符合严格状态序列');
        }
        if (rewardObserved && !value.clientRewardObserved) {
          throw new Error('奖励观察状态不能回退');
        }
        showingSeen = true;
      }
      if (value.nativeState === 'CLOSED' && value.clientRewardObserved !== rewardObserved) {
        throw new Error('关闭回调的奖励观察状态与当前会话不一致');
      }
      if (value.nativeState === 'ERROR' && (value.providerShowId !== null) !== showingSeen) {
        throw new Error('失败回调的展示证据与当前会话不一致');
      }
      if (value.nativeState === 'ERROR' && value.clientRewardObserved !== rewardObserved) {
        throw new Error('失败回调的奖励观察状态与当前会话不一致');
      }
      lastSequence = value.callbackSequence;
      previousState = value.nativeState;
      sdkRequestId ||= value.sdkRequestId;
      providerShowId ||= value.providerShowId;
      rewardObserved ||= value.clientRewardObserved;
      terminal = value.nativeState === 'CLOSED' || value.nativeState === 'ERROR';
      return value;
    },
  });
}

export function nativeTelemetryToClientEvent(value) {
  if (value.nativeState === 'LOADED') {
    return null;
  }
  const eventTypes = {
    LOADING: 'LOAD_STARTED',
    SHOWING: value.clientRewardObserved ? 'REWARD_OBSERVED' : 'SHOWN',
    CLOSED: 'CLOSED',
    ERROR: 'FAILED',
  };
  const eventType = eventTypes[value.nativeState];
  if (!eventType) {
    throw new Error('原生状态不能转换为客户端事件');
  }
  return Object.freeze({
    protocolVersion: value.protocolVersion,
    clientEventId: `${value.sessionId}:${value.callbackSequence}`,
    callbackSequence: value.callbackSequence,
    sessionId: value.sessionId,
    provider: value.provider,
    placementId: value.placementId,
    eventType,
    nativeState: value.nativeState,
    sdkRequestId: value.sdkRequestId,
    providerShowId: value.providerShowId,
    networkFirmId: value.networkFirmId,
    adsourceId: value.adsourceId,
    clientRewardObserved: value.clientRewardObserved,
    closed: value.closed,
  });
}

export function callNativeMethod(plugin, method, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;

  return new Promise((resolve, reject) => {
    if (!plugin || typeof plugin[method] !== 'function') {
      reject(new Error(`Native method unavailable: ${method}`));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Native method timeout: ${method}`));
      }
    }, timeoutMs);

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result || {});
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error || 'Native method failed')));
    }

    try {
      const result = plugin[method](payload, finish);
      if (result && typeof result.then === 'function') {
        result.then(finish).catch(fail);
      } else if (result !== undefined) {
        finish(result);
      }
    } catch (error) {
      fail(error);
    }
  });
}
