import AdSessionApi from '@/sheep/api/member/ad-session';
import EntitlementApi from '@/sheep/api/member/entitlement';
import { createAdSessionOrchestrator } from './ad-session-orchestrator';

export const adSessionOrchestrator = createAdSessionOrchestrator({
  api: {
    createAdSession: AdSessionApi.createAdSession,
    getAdSession: AdSessionApi.getAdSession,
    recordClientEvents: AdSessionApi.recordClientEvents,
    issuePlayerGrant: AdSessionApi.issuePlayerGrant,
    getEntitlements: EntitlementApi.getEntitlements,
  },
});

const recoveryPromises = new Map();

function identityKey(identity) {
  const tenantId = String(identity?.tenantId ?? '').trim();
  const memberId = String(identity?.memberId ?? '').trim();
  if (!tenantId || !memberId) {
    throw new Error('待验证广告会话缺少当前租户或会员 identity');
  }
  return `${tenantId}:${memberId}`;
}

export function recoverPendingAdSessions(identity) {
  const key = identityKey(identity);
  const existing = recoveryPromises.get(key);
  if (existing) {
    return existing;
  }
  const recovery = adSessionOrchestrator
    .recoverPendingSessions(identity)
    .finally(() => recoveryPromises.delete(key));
  recoveryPromises.set(key, recovery);
  return recovery;
}
