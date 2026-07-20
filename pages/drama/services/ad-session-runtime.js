import AdSessionApi from '@/sheep/api/member/ad-session';
import EntitlementApi from '@/sheep/api/member/entitlement';
import { createAdSessionOrchestrator } from './ad-session-orchestrator';
import { createAdSessionRecoveryCoordinator } from './ad-session-recovery-coordinator';

export const adSessionOrchestrator = createAdSessionOrchestrator({
  api: {
    createAdSession: AdSessionApi.createAdSession,
    getAdSession: AdSessionApi.getAdSession,
    recordClientEvents: AdSessionApi.recordClientEvents,
    issuePlayerGrant: AdSessionApi.issuePlayerGrant,
    getEntitlements: EntitlementApi.getEntitlements,
  },
});

const recoveryCoordinator = createAdSessionRecoveryCoordinator();

export function acquireAdSessionOwnership(identity) {
  return recoveryCoordinator.acquire(identity);
}

export function recoverPendingAdSessions(identity) {
  return recoveryCoordinator.runRecovery(identity, () =>
    adSessionOrchestrator.recoverPendingSessions(identity),
  );
}
