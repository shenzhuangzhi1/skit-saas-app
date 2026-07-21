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

export function acquireAdSessionOwnership(scope) {
  return recoveryCoordinator.acquire(scope);
}

export function recoverPendingAdSessions(identity, options = {}) {
  const sessions = adSessionOrchestrator.getPendingSessions(identity);
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  return Promise.all(
    sessions.map((session) => {
      const scope = {
        ...identity,
        dramaId: session.dramaId,
        episodeNo: session.episodeNo,
      };
      return recoveryCoordinator
        .runRecovery(scope, session.sessionId, async () => {
          try {
            return await adSessionOrchestrator.pollSession(identity, session.sessionId);
          } catch (error) {
            return { resolution: 'UNAVAILABLE', sessionId: session.sessionId, error };
          }
        })
        .then(async (result) => {
          await onResult?.(result, session);
          return result;
        });
    }),
  );
}
