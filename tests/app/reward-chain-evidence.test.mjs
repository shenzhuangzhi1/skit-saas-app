import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFreshRewardChainEvidence,
  showReference,
  summarizeMemberRequest,
  summarizeMemberResponse,
  toSafeEvidenceLog,
} from '../../scripts/lib/reward-chain-evidence.mjs';

const apiBase = 'https://api.example.test/app-api/skit/member';
const sessionId = 'abcdefghijklmnopqrstuv';
const providerShowId = 'taku-show-20260719';
const providerShowRef = showReference(providerShowId);

function exchange(runId, path, request, responseData) {
  const url = `${apiBase}${path}`;
  return {
    runId,
    request: summarizeMemberRequest(url, request),
    response: summarizeMemberResponse(
      url,
      JSON.stringify({ code: 0, data: responseData }),
      200,
    ),
  };
}

function validEvidence() {
  return {
    runId: 1,
    rewardClickPerformed: true,
    requestedDrama: 3474,
    requestedEpisode: 1,
    nativeLogs: [
      'TAKU_TELEMETRY state=LOADING callbackSequence=0 rewardObserved=false closed=false showRef=<none>',
      'TAKU_TELEMETRY state=LOADED callbackSequence=1 rewardObserved=false closed=false showRef=<none>',
      `TAKU_TELEMETRY state=SHOWING callbackSequence=2 rewardObserved=false closed=false showRef=${providerShowRef}`,
      `TAKU_TELEMETRY state=SHOWING callbackSequence=3 rewardObserved=true closed=false showRef=${providerShowRef}`,
      `TAKU_TELEMETRY state=CLOSED callbackSequence=4 rewardObserved=true closed=true showRef=${providerShowRef}`,
    ].join('\n'),
    exchanges: [
      exchange(
        1,
        '/ad-sessions',
        {
          method: 'POST',
          postData: JSON.stringify({ dramaId: 3474, episodeNo: 1 }),
        },
        { outcome: 'CREATED', sessionId },
      ),
      exchange(
        1,
        `/ad-sessions/${sessionId}/client-events`,
        {
          method: 'POST',
          postData: JSON.stringify({
            events: [{ providerShowId, nativeState: 'CLOSED' }],
          }),
        },
        {
          sessionId,
          rewardVerificationStatus: 'PENDING',
          entitlementStatus: 'NONE',
          providerShowId,
        },
      ),
      exchange(
        1,
        `/ad-sessions/${sessionId}`,
        { method: 'GET' },
        {
          sessionId,
          rewardVerificationStatus: 'SIGNED_VERIFIED',
          entitlementStatus: 'GRANTED',
          providerShowId,
        },
      ),
      exchange(
        1,
        '/entitlements?dramaId=3474',
        { method: 'GET' },
        { dramaId: 3474, grantedEpisodeNos: [1] },
      ),
      exchange(
        1,
        '/player-grants',
        { method: 'POST', postData: JSON.stringify({ dramaId: 3474 }) },
        {
          grantId: 91,
          dramaId: 3474,
          grantToken: 'x'.repeat(43),
          expiresAt: '2026-07-19T13:00:00',
        },
      ),
    ],
  };
}

test('request summaries preserve only the fields needed to correlate the reward chain', () => {
  const create = summarizeMemberRequest(`${apiBase}/ad-sessions`, {
    method: 'POST',
    postData: JSON.stringify({ dramaId: 3474, episodeNo: 1, ignored: 'secret' }),
    headers: { Authorization: 'Bearer secret', 'tenant-id': '9' },
  });
  assert.deepEqual(create, {
    endpoint: '/app-api/skit/member/ad-sessions',
    method: 'POST',
    sessionId: null,
    dramaId: 3474,
    episodeNo: 1,
    providerShowRefs: [],
    hasAuthorization: true,
    hasTenantId: true,
    hasNativeVersion: false,
    hasProtocolVersion: false,
  });

  const entitlement = summarizeMemberRequest(
    `${apiBase}/entitlements?dramaId=3474`,
    { method: 'GET' },
  );
  assert.equal(entitlement.dramaId, 3474);

  const clientEvent = summarizeMemberRequest(
    `${apiBase}/ad-sessions/${sessionId}/client-events`,
    {
      method: 'POST',
      postData: JSON.stringify({ events: [{ providerShowId }] }),
    },
  );
  assert.equal(clientEvent.sessionId, sessionId);
  assert.deepEqual(clientEvent.providerShowRefs, [providerShowRef]);
});

test('accepts one fresh, fully correlated ad reward and playback chain', () => {
  const result = assertFreshRewardChainEvidence(validEvidence());
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.providerShowRef, providerShowRef);
});

test('rejects evidence assembled from the wrong run, content scope, or provider show', () => {
  const stale = validEvidence();
  stale.exchanges = stale.exchanges.map((item) => ({ ...item, runId: 0 }));
  assert.throws(() => assertFreshRewardChainEvidence(stale), /CREATED/);

  const wrongEpisode = validEvidence();
  wrongEpisode.exchanges[0].request.episodeNo = 2;
  assert.throws(() => assertFreshRewardChainEvidence(wrongEpisode), /CREATED/);

  const wrongEntitlementDrama = validEvidence();
  wrongEntitlementDrama.exchanges[3].request.dramaId = 999;
  assert.throws(() => assertFreshRewardChainEvidence(wrongEntitlementDrama), /entitlement/i);

  const wrongShow = validEvidence();
  wrongShow.exchanges[2].response.providerShowRef = showReference('another-show');
  assert.throws(() => assertFreshRewardChainEvidence(wrongShow), /show/i);

  const wrongGrantDrama = validEvidence();
  wrongGrantDrama.exchanges[4].request.dramaId = 999;
  assert.throws(() => assertFreshRewardChainEvidence(wrongGrantDrama), /grant/i);
});

test('diagnostics use stable aliases and omit raw identifiers and response messages', () => {
  const evidence = validEvidence();
  const safe = JSON.stringify(toSafeEvidenceLog(evidence.exchanges));
  assert.match(safe, /session#1/);
  assert.doesNotMatch(safe, new RegExp(sessionId));
  assert.doesNotMatch(safe, /grantId|expiresAt|message|Bearer secret/);
});
