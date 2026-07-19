const PROTOCOL_VERSION = 1;
const PROVIDER = 'TAKU';
const SCENE = 'drama_unlock';
const POLL_DELAYS_MS = Object.freeze([500, 1000, 2000, 3000, 3000]);
const PENDING_RECOVERY_DELAYS_MS = Object.freeze([5000, 10000, 15000, 30000, 30000]);
const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SAFE_TEXT_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,256}$/;
const PLAYER_GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ENTITLEMENT_CACHE_PREFIX = 'skit_ad_entitlement_ui_v1';
const PENDING_SESSION_PREFIX = 'skit_ad_pending_session_v1';

const CLIENT_LIFECYCLE_STATUSES = new Set([
  'CREATED',
  'LOADING',
  'SHOWN',
  'CLIENT_REWARDED',
  'CLOSED',
  'FAILED',
  'LOAD_EXPIRED',
]);
const REWARD_STATUSES = new Set(['PENDING', 'SIGNED_VERIFIED', 'REJECTED', 'VERIFY_TIMEOUT']);
const ENTITLEMENT_STATUSES = new Set(['NONE', 'GRANTED', 'SECURITY_REVOKED']);
const REVENUE_STATUSES = new Set([
  'NONE',
  'IMPRESSION_PENDING_REWARD',
  'FROZEN',
  'RECONCILING',
  'RECONCILED',
  'SUSPENSE',
]);

function defaultStorage() {
  return {
    get: (key) => uni.getStorageSync(key),
    set: (key, value) => uni.setStorageSync(key, value),
    remove: (key) => uni.removeStorageSync(key),
  };
}

function defaultSleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function requireIdentity(identity) {
  const tenantId = String(identity?.tenantId ?? '').trim();
  const memberId = String(identity?.memberId ?? '').trim();
  if (!tenantId || tenantId === 'undefined' || tenantId === 'null') {
    throw new Error('当前租户 identity 未就绪');
  }
  if (!memberId || memberId === 'undefined' || memberId === 'null') {
    throw new Error('当前会员 member identity 未就绪');
  }
  return Object.freeze({ tenantId, memberId });
}

function identityKey(identity) {
  const normalized = requireIdentity(identity);
  return `${encodeURIComponent(normalized.tenantId)}:${encodeURIComponent(normalized.memberId)}`;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label}必须是正整数`);
  }
  return number;
}

function requireSafeText(value, label) {
  const text = String(value ?? '');
  if (!SAFE_TEXT_PATTERN.test(text)) {
    throw new Error(`${label}格式错误`);
  }
  return text;
}

function unwrap(result, operation) {
  if (!result || result.code !== 0) {
    throw new Error(result?.msg || `${operation}失败`);
  }
  if (result.data === undefined || result.data === null) {
    throw new Error(`${operation}没有返回数据`);
  }
  return result.data;
}

export function validateServerAdProtocol(value) {
  if (value?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('广告 protocol 版本不受支持');
  }
  if (!SESSION_PATTERN.test(String(value?.sessionId ?? ''))) {
    throw new Error('广告会话编号格式错误');
  }
  if (value?.provider !== PROVIDER) {
    throw new Error('仅支持 TAKU 广告协议');
  }
  const placementId = requireSafeText(value?.placementId, '广告位');
  const userId = requireSafeText(value?.userId, '用户标识');
  const customData = String(value?.customData ?? '');
  if (!TOKEN_PATTERN.test(customData)) {
    throw new Error('广告会话令牌格式错误');
  }
  if (value?.scene !== SCENE) {
    throw new Error('广告场景不受支持');
  }
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: value.sessionId,
    provider: PROVIDER,
    placementId,
    userId,
    customData,
    scene: SCENE,
  });
}

function normalizeEpisodes(value) {
  if (!Array.isArray(value)) {
    throw new Error('服务端权益集数格式错误');
  }
  const episodes = value.map((episode) => requirePositiveInteger(episode, '权益集数'));
  return [...new Set(episodes)].sort((left, right) => left - right);
}

function validateSessionStatus(value, expectedSessionId) {
  if (!value || value.sessionId !== expectedSessionId) {
    throw new Error('服务端返回了其他广告会话的状态');
  }
  if (!CLIENT_LIFECYCLE_STATUSES.has(value.clientLifecycleStatus)) {
    throw new Error('客户端生命周期状态不受支持');
  }
  if (!REWARD_STATUSES.has(value.rewardVerificationStatus)) {
    throw new Error('奖励验证状态不受支持');
  }
  if (!ENTITLEMENT_STATUSES.has(value.entitlementStatus)) {
    throw new Error('内容权益状态不受支持');
  }
  if (!REVENUE_STATUSES.has(value.revenueStatus)) {
    throw new Error('收益状态不受支持');
  }
  return Object.freeze({ ...value });
}

function validateClientEvent(protocol, value) {
  if (!value || value.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('客户端 protocol 版本错误');
  }
  if (value.sessionId !== protocol.sessionId) {
    throw new Error('客户端事件广告会话不匹配');
  }
  if (value.provider !== PROVIDER) {
    throw new Error('客户端事件只能使用 TAKU');
  }
  if (value.placementId !== protocol.placementId) {
    throw new Error('客户端事件广告位 placement 不匹配');
  }
  if (!Number.isSafeInteger(value.callbackSequence) || value.callbackSequence < 0) {
    throw new Error('客户端事件回调序号格式错误');
  }
  requireSafeText(value.clientEventId, '客户端事件编号');
  requireSafeText(value.sdkRequestId, 'SDK 请求编号');
  return value;
}

function pendingStorageKey(identity) {
  return `${PENDING_SESSION_PREFIX}:${identityKey(identity)}`;
}

function entitlementStorageKey(identity, dramaId) {
  return `${ENTITLEMENT_CACHE_PREFIX}:${identityKey(identity)}:${dramaId}`;
}

function readList(storage, key) {
  const value = storage.get(key);
  return Array.isArray(value) ? value : [];
}

export function createAdSessionOrchestrator(options = {}) {
  const api = options.api;
  const storage = options.storage || defaultStorage();
  const sleep = options.sleep || defaultSleep;
  const now = options.now || (() => Date.now());
  if (
    !api ||
    typeof api.createAdSession !== 'function' ||
    typeof api.getAdSession !== 'function' ||
    typeof api.recordClientEvents !== 'function' ||
    typeof api.issuePlayerGrant !== 'function' ||
    typeof api.getEntitlements !== 'function'
  ) {
    throw new Error('广告会话 API 未完整配置');
  }

  function getPendingSessions(identity) {
    const normalized = requireIdentity(identity);
    return readList(storage, pendingStorageKey(normalized)).filter(
      (item) =>
        item &&
        item.tenantId === normalized.tenantId &&
        item.memberId === normalized.memberId &&
        SESSION_PATTERN.test(String(item.sessionId || '')) &&
        Number.isSafeInteger(item.dramaId) &&
        item.dramaId > 0,
    );
  }

  function persistPending(identity, pending) {
    const normalized = requireIdentity(identity);
    const key = pendingStorageKey(normalized);
    const existing = getPendingSessions(normalized).filter(
      (item) => item.sessionId !== pending.sessionId,
    );
    storage.set(
      key,
      [
        ...existing,
        {
          tenantId: normalized.tenantId,
          memberId: normalized.memberId,
          sessionId: pending.sessionId,
          dramaId: pending.dramaId,
          episodeNo: pending.episodeNo,
          rewardAcceptUntil: pending.rewardAcceptUntil || null,
          persistedAt: now(),
        },
      ].slice(-20),
    );
  }

  function removePending(identity, sessionId) {
    const normalized = requireIdentity(identity);
    const key = pendingStorageKey(normalized);
    const remaining = getPendingSessions(normalized).filter((item) => item.sessionId !== sessionId);
    if (remaining.length === 0) {
      storage.remove(key);
    } else {
      storage.set(key, remaining);
    }
  }

  async function refreshEntitlements(identity, dramaIdInput) {
    const normalized = requireIdentity(identity);
    const dramaId = requirePositiveInteger(dramaIdInput, '短剧编号');
    const data = unwrap(await api.getEntitlements(dramaId), '刷新服务端权益');
    if (Number(data.dramaId) !== dramaId) {
      throw new Error('服务端返回了其他短剧的权益');
    }
    const snapshot = {
      tenantId: normalized.tenantId,
      memberId: normalized.memberId,
      dramaId,
      grantedEpisodeNos: normalizeEpisodes(data.grantedEpisodeNos),
      displayOnly: true,
      fetchedAt: now(),
    };
    storage.set(entitlementStorageKey(normalized, dramaId), snapshot);
    return Object.freeze({ ...snapshot, grantedEpisodeNos: [...snapshot.grantedEpisodeNos] });
  }

  function getCachedEntitlementsForUi(identity, dramaIdInput) {
    const normalized = requireIdentity(identity);
    const dramaId = requirePositiveInteger(dramaIdInput, '短剧编号');
    const cached = storage.get(entitlementStorageKey(normalized, dramaId));
    if (
      !cached ||
      cached.tenantId !== normalized.tenantId ||
      cached.memberId !== normalized.memberId ||
      cached.dramaId !== dramaId ||
      !Array.isArray(cached.grantedEpisodeNos)
    ) {
      return { dramaId, grantedEpisodeNos: [], displayOnly: true };
    }
    let grantedEpisodeNos = [];
    try {
      grantedEpisodeNos = normalizeEpisodes(cached.grantedEpisodeNos);
    } catch (error) {
      return { dramaId, grantedEpisodeNos: [], displayOnly: true };
    }
    return { ...cached, grantedEpisodeNos, displayOnly: true };
  }

  async function isAuthoritativelyEntitled(identity, dramaId, episodeNoInput) {
    const episodeNo = requirePositiveInteger(episodeNoInput, '剧集编号');
    const snapshot = await refreshEntitlements(identity, dramaId);
    return snapshot.grantedEpisodeNos.includes(episodeNo);
  }

  async function createSession(identity, input = {}) {
    const normalized = requireIdentity(identity);
    const dramaId = requirePositiveInteger(input.dramaId, '短剧编号');
    const episodeNo = requirePositiveInteger(input.episodeNo, '解锁集数');
    const data = unwrap(await api.createAdSession({ dramaId, episodeNo }), '创建广告会话');
    if (data.outcome === 'ALREADY_ENTITLED') {
      return { outcome: data.outcome, nativeProtocol: null };
    }
    if (data.outcome !== 'CREATED' && data.outcome !== 'REUSED') {
      throw new Error('服务端广告会话结果不受支持');
    }
    const nativeProtocol = validateServerAdProtocol(data);
    persistPending(normalized, {
      sessionId: nativeProtocol.sessionId,
      dramaId,
      episodeNo,
      rewardAcceptUntil: data.rewardAcceptUntil,
    });
    return {
      outcome: data.outcome,
      nativeProtocol,
      requiresVerificationPoll: data.outcome === 'REUSED',
      loadExpiresAt: data.loadExpiresAt,
      rewardAcceptUntil: data.rewardAcceptUntil,
    };
  }

  async function prepareUnlockSession(identity, input = {}) {
    const normalized = requireIdentity(identity);
    const dramaId = requirePositiveInteger(input.dramaId, '短剧编号');
    const episodeNo = requirePositiveInteger(input.episodeNo, '解锁集数');
    const existing = getPendingSessions(normalized).find(
      (item) => item.dramaId === dramaId && item.episodeNo === episodeNo,
    );
    if (existing) {
      const recovered = await pollSession(normalized, existing.sessionId);
      if (recovered.resolution !== 'REJECTED' && recovered.resolution !== 'VERIFY_TIMEOUT') {
        return { kind: 'RECOVERED', result: recovered };
      }
    }
    return {
      kind: 'CREATED',
      created: await createSession(normalized, { dramaId, episodeNo }),
    };
  }

  async function issuePlayerGrant(identity, dramaIdInput) {
    requireIdentity(identity);
    const dramaId = requirePositiveInteger(dramaIdInput, '短剧编号');
    const data = unwrap(await api.issuePlayerGrant(dramaId), '签发播放器权限');
    const grantId = requirePositiveInteger(data.grantId, '播放器权限编号');
    if (Number(data.dramaId) !== dramaId) {
      throw new Error('播放器权限绑定了其他短剧');
    }
    if (!PLAYER_GRANT_TOKEN_PATTERN.test(String(data.grantToken || ''))) {
      throw new Error('播放器权限令牌格式错误');
    }
    if (!data.expiresAt) {
      throw new Error('播放器权限缺少过期时间');
    }
    return Object.freeze({
      grantId,
      dramaId,
      expiresAt: data.expiresAt,
      grantToken: data.grantToken,
    });
  }

  async function recordClientEvent(identity, serverProtocol, clientEvent) {
    requireIdentity(identity);
    const nativeProtocol = validateServerAdProtocol(serverProtocol);
    validateClientEvent(nativeProtocol, clientEvent);
    const data = unwrap(
      await api.recordClientEvents(nativeProtocol.sessionId, [clientEvent]),
      '记录广告客户端事件',
    );
    return validateSessionStatus(data, nativeProtocol.sessionId);
  }

  async function pollSession(identity, sessionId) {
    const normalized = requireIdentity(identity);
    const pending = getPendingSessions(normalized).find((item) => item.sessionId === sessionId);
    if (!pending) {
      throw new Error('当前 identity 下没有这个待验证广告会话');
    }
    let status;
    for (const delay of POLL_DELAYS_MS) {
      await sleep(delay);
      status = validateSessionStatus(
        unwrap(await api.getAdSession(sessionId), '查询广告会话'),
        sessionId,
      );
      if (status.entitlementStatus === 'GRANTED') {
        if (status.rewardVerificationStatus !== 'SIGNED_VERIFIED') {
          throw new Error('服务端权益状态缺少已验签奖励证明');
        }
        removePending(normalized, sessionId);
        const entitlements = await refreshEntitlements(normalized, pending.dramaId);
        return { resolution: 'GRANTED', status, entitlements };
      }
      if (status.entitlementStatus === 'SECURITY_REVOKED') {
        removePending(normalized, sessionId);
        return { resolution: 'SECURITY_REVOKED', status };
      }
      if (
        status.rewardVerificationStatus === 'REJECTED' ||
        status.rewardVerificationStatus === 'VERIFY_TIMEOUT'
      ) {
        removePending(normalized, sessionId);
        return { resolution: status.rewardVerificationStatus, status };
      }
    }
    return { resolution: 'VERIFYING', status };
  }

  async function watchPendingSession(identity, sessionId) {
    let result = await pollSession(identity, sessionId);
    for (const delay of PENDING_RECOVERY_DELAYS_MS) {
      if (result.resolution !== 'VERIFYING') {
        return result;
      }
      await sleep(delay);
      result = await pollSession(identity, sessionId);
    }
    return result;
  }

  async function recoverPendingSessions(identity) {
    const normalized = requireIdentity(identity);
    const sessions = getPendingSessions(normalized);
    const results = [];
    for (const session of sessions) {
      try {
        results.push(await pollSession(normalized, session.sessionId));
      } catch (error) {
        results.push({ resolution: 'UNAVAILABLE', sessionId: session.sessionId, error });
      }
    }
    return results;
  }

  return Object.freeze({
    createSession,
    prepareUnlockSession,
    issuePlayerGrant,
    recordClientEvent,
    pollSession,
    watchPendingSession,
    recoverPendingSessions,
    refreshEntitlements,
    isAuthoritativelyEntitled,
    getCachedEntitlementsForUi,
    getPendingSessions,
    removePending,
  });
}
