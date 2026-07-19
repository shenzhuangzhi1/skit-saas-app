import { createHash } from 'node:crypto';

const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
}

function sessionIdFromUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\/ad-sessions\/([A-Za-z0-9_-]{22})(?:\/|$)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function memberEndpoint(url) {
  try {
    return new URL(url).pathname.replace(
      /\/ad-sessions\/[^/]+(?=\/|$)/,
      '/ad-sessions/:sessionId',
    );
  } catch {
    return '<invalid-member-endpoint>';
  }
}

export function showReference(providerShowId) {
  if (typeof providerShowId !== 'string' || providerShowId.length === 0) return null;
  return createHash('sha256').update(providerShowId, 'utf8').digest('hex').slice(0, 12);
}

export function summarizeMemberRequest(url, request = {}) {
  const endpoint = memberEndpoint(url);
  const body = parseJsonObject(request.postData);
  const headers = normalizeHeaders(request.headers);
  let queryDramaId = null;
  try {
    queryDramaId = positiveInteger(new URL(url).searchParams.get('dramaId'));
  } catch {
    queryDramaId = null;
  }
  const providerShowRefs = Array.isArray(body.events)
    ? [
        ...new Set(
          body.events
            .map((event) => showReference(event?.providerShowId))
            .filter(Boolean),
        ),
      ]
    : [];
  return {
    endpoint,
    method: String(request.method || 'GET').toUpperCase(),
    sessionId: sessionIdFromUrl(url),
    dramaId: positiveInteger(body.dramaId) ?? queryDramaId,
    episodeNo: positiveInteger(body.episodeNo),
    providerShowRefs,
    hasAuthorization: Boolean(headers.authorization),
    hasTenantId: Boolean(headers['tenant-id']),
    hasNativeVersion: Boolean(headers['x-skit-native-version']),
    hasProtocolVersion: Boolean(headers['x-skit-ad-protocol-version']),
  };
}

export function summarizeMemberResponse(url, body, status) {
  const endpoint = memberEndpoint(url);
  try {
    const envelope = JSON.parse(body);
    const data = envelope?.data || {};
    return {
      endpoint,
      httpStatus: Number(status),
      code: envelope?.code ?? null,
      sessionId:
        typeof data.sessionId === 'string' && SESSION_PATTERN.test(data.sessionId)
          ? data.sessionId
          : null,
      outcome: typeof data.outcome === 'string' ? data.outcome : null,
      rewardVerificationStatus:
        typeof data.rewardVerificationStatus === 'string'
          ? data.rewardVerificationStatus
          : null,
      entitlementStatus:
        typeof data.entitlementStatus === 'string' ? data.entitlementStatus : null,
      providerShowRef: showReference(data.providerShowId),
      dramaId: positiveInteger(data.dramaId),
      grantedEpisodeNos: Array.isArray(data.grantedEpisodeNos)
        ? data.grantedEpisodeNos
            .map(positiveInteger)
            .filter((episodeNo) => episodeNo !== null)
        : [],
      hasGrantId: positiveInteger(data.grantId) !== null,
      grantTokenLength:
        typeof data.grantToken === 'string' ? data.grantToken.length : null,
    };
  } catch {
    return { endpoint, httpStatus: Number(status), parseError: true };
  }
}

function successful(exchange) {
  return exchange.response?.httpStatus === 200 && exchange.response?.code === 0;
}

export function assertFreshRewardChainEvidence({
  runId,
  rewardClickPerformed,
  requestedDrama,
  requestedEpisode,
  nativeLogs,
  exchanges,
}) {
  if (!rewardClickPerformed) {
    throw new Error('Reward verification did not perform a fresh ad-unlock click');
  }
  const current = exchanges.filter((exchange) => exchange.runId === runId);
  const created = current.find(
    (exchange) =>
      exchange.request?.endpoint.endsWith('/ad-sessions') &&
      exchange.request?.method === 'POST' &&
      exchange.request?.dramaId === requestedDrama &&
      exchange.request?.episodeNo === requestedEpisode &&
      successful(exchange) &&
      exchange.response?.outcome === 'CREATED' &&
      exchange.response?.sessionId,
  );
  if (!created) {
    throw new Error('Fresh scope-bound CREATED ad-session evidence is missing');
  }

  const sessionId = created.response.sessionId;
  const verified = current.find(
    (exchange) =>
      exchange.request?.sessionId === sessionId &&
      successful(exchange) &&
      exchange.response?.sessionId === sessionId &&
      exchange.response?.rewardVerificationStatus === 'SIGNED_VERIFIED' &&
      exchange.response?.entitlementStatus === 'GRANTED' &&
      exchange.response?.providerShowRef,
  );
  if (!verified) {
    throw new Error('Same-session signed reward, entitlement, and provider show evidence is missing');
  }

  const sessionRef = showReference(sessionId);
  const providerShowRef = verified.response.providerShowRef;
  const clientShow = current.find(
    (exchange) =>
      exchange.request?.endpoint.endsWith('/client-events') &&
      exchange.request?.method === 'POST' &&
      exchange.request?.sessionId === sessionId &&
      exchange.request?.providerShowRefs.includes(providerShowRef) &&
      successful(exchange) &&
      exchange.response?.sessionId === sessionId,
  );
  if (!clientShow) {
    throw new Error('Client and server provider show evidence is not correlated');
  }

  const requiredNativeEvidence = [
    `TAKU_TELEMETRY state=LOADING callbackSequence=0 rewardObserved=false closed=false sessionRef=${sessionRef} showRef=<none>`,
    `TAKU_TELEMETRY state=LOADED callbackSequence=1 rewardObserved=false closed=false sessionRef=${sessionRef} showRef=<none>`,
    `TAKU_TELEMETRY state=SHOWING callbackSequence=2 rewardObserved=false closed=false sessionRef=${sessionRef} showRef=${providerShowRef}`,
    `TAKU_TELEMETRY state=SHOWING callbackSequence=3 rewardObserved=true closed=false sessionRef=${sessionRef} showRef=${providerShowRef}`,
    `TAKU_TELEMETRY state=CLOSED callbackSequence=4 rewardObserved=true closed=true sessionRef=${sessionRef} showRef=${providerShowRef}`,
  ];
  let cursor = 0;
  for (const evidence of requiredNativeEvidence) {
    const index = nativeLogs.indexOf(evidence, cursor);
    if (index < 0) {
      throw new Error(`Fresh native provider show evidence is missing: ${evidence}`);
    }
    cursor = index + evidence.length;
  }

  const playerEvidence = `PLAYER_PLAYING dramaId=${requestedDrama} episode=${requestedEpisode} sessionRef=${sessionRef} showRef=${providerShowRef}`;
  const playerIndex = nativeLogs.indexOf(playerEvidence, cursor);
  const requestFailureEvidence = `PLAYER_REQUEST_FAILED dramaId=${requestedDrama} episode=${requestedEpisode} sessionRef=${sessionRef} showRef=${providerShowRef}`;
  const requestFailureIndex = nativeLogs.indexOf(requestFailureEvidence, cursor);
  if (requestFailureIndex >= 0 && (playerIndex < 0 || requestFailureIndex < playerIndex)) {
    throw new Error('Target player request failed before real video playback');
  }
  if (playerIndex < 0) {
    throw new Error(`Fresh native player evidence is missing: ${playerEvidence}`);
  }

  const entitlement = current.find(
    (exchange) =>
      exchange.request?.endpoint.endsWith('/entitlements') &&
      exchange.request?.method === 'GET' &&
      exchange.request?.dramaId === requestedDrama &&
      successful(exchange) &&
      exchange.response?.dramaId === requestedDrama &&
      exchange.response?.grantedEpisodeNos.includes(requestedEpisode),
  );
  if (!entitlement) {
    throw new Error('Requested drama and episode entitlement evidence is missing');
  }

  const playerGrant = current.find(
    (exchange) =>
      exchange.request?.endpoint.endsWith('/player-grants') &&
      exchange.request?.method === 'POST' &&
      exchange.request?.dramaId === requestedDrama &&
      successful(exchange) &&
      exchange.response?.dramaId === requestedDrama &&
      exchange.response?.hasGrantId === true &&
      Number.isSafeInteger(exchange.response?.grantTokenLength) &&
      exchange.response.grantTokenLength >= 20,
  );
  if (!playerGrant) {
    throw new Error('Fresh drama-bound player grant evidence is missing');
  }

  return { sessionId, sessionRef, providerShowRef };
}

export function toSafeEvidenceLog(exchanges) {
  const sessionAliases = new Map();
  const alias = (sessionId) => {
    if (!sessionId) return null;
    if (!sessionAliases.has(sessionId)) {
      sessionAliases.set(sessionId, `session#${sessionAliases.size + 1}`);
    }
    return sessionAliases.get(sessionId);
  };
  return exchanges.map((exchange) => ({
    runId: exchange.runId,
    request: {
      endpoint: exchange.request?.endpoint,
      method: exchange.request?.method,
      session: alias(exchange.request?.sessionId),
      dramaId: exchange.request?.dramaId,
      episodeNo: exchange.request?.episodeNo,
      providerShowRefs: exchange.request?.providerShowRefs || [],
      hasAuthorization: exchange.request?.hasAuthorization,
      hasTenantId: exchange.request?.hasTenantId,
      hasNativeVersion: exchange.request?.hasNativeVersion,
      hasProtocolVersion: exchange.request?.hasProtocolVersion,
    },
    response: {
      endpoint: exchange.response?.endpoint,
      httpStatus: exchange.response?.httpStatus,
      code: exchange.response?.code,
      session: alias(exchange.response?.sessionId),
      outcome: exchange.response?.outcome,
      rewardVerificationStatus: exchange.response?.rewardVerificationStatus,
      entitlementStatus: exchange.response?.entitlementStatus,
      providerShowRef: exchange.response?.providerShowRef,
      dramaId: exchange.response?.dramaId,
      grantedEpisodeNos: exchange.response?.grantedEpisodeNos || [],
      hasGrantId: exchange.response?.hasGrantId,
      grantTokenLength: exchange.response?.grantTokenLength,
      parseError: exchange.response?.parseError === true,
    },
  }));
}
