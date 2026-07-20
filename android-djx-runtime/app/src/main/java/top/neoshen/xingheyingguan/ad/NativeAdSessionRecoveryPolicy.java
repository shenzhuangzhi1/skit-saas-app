package top.neoshen.xingheyingguan.ad;

/**
 * Bounds orphaned poll-only session replacement to one server create per native unlock flow.
 */
public final class NativeAdSessionRecoveryPolicy {
    private long activeGeneration;
    private boolean replacementConsumed;

    public synchronized void begin(long generation) {
        if (generation <= 0L) {
            throw new IllegalArgumentException("Invalid native unlock generation");
        }
        activeGeneration = generation;
        replacementConsumed = false;
    }

    public synchronized boolean consumeIfRecoverable(
            long generation, boolean pollOnlySession,
            String expectedSessionId, String actualSessionId,
            String clientLifecycleStatus, String rewardVerificationStatus,
            String providerShowId) {
        if (generation <= 0L || generation != activeGeneration || replacementConsumed
                || !pollOnlySession || expectedSessionId == null
                || !expectedSessionId.equals(actualSessionId) || providerShowId != null
                || !"LOAD_EXPIRED".equals(clientLifecycleStatus)
                || !"REJECTED".equals(rewardVerificationStatus)) {
            return false;
        }
        replacementConsumed = true;
        return true;
    }

    public synchronized void cancel(long generation) {
        if (generation > 0L && generation == activeGeneration) {
            activeGeneration = 0L;
            replacementConsumed = false;
        }
    }
}
