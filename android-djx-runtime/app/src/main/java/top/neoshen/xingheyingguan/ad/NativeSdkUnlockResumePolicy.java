package top.neoshen.xingheyingguan.ad;

import java.util.Collection;

/**
 * Carries one server-authorized episode across DJX's asynchronous unlock completion callback.
 */
public final class NativeSdkUnlockResumePolicy {
    private long callbackEpoch;
    private long dramaId;
    private int episode;
    private boolean resumePending;

    public synchronized void arm(long callbackEpoch, long dramaId, int episode) {
        if (callbackEpoch <= 0L || dramaId <= 0L || episode <= 0) {
            throw new IllegalArgumentException("Invalid DJX resume scope");
        }
        if (this.callbackEpoch != 0L) {
            throw new IllegalStateException("DJX resume scope is already outstanding");
        }
        this.callbackEpoch = callbackEpoch;
        this.dramaId = dramaId;
        this.episode = episode;
        resumePending = false;
    }

    /**
     * Returns the exact episode to resume only when the server entitlement is present.
     * DJX's custom-ad completion status is advisory and may report an ad error after the
     * signed reward has already granted the episode.
     */
    public synchronized int completeWithServerEntitlements(
            long callbackEpoch, long dramaId, int reportedEpisode,
            Collection<Integer> serverEntitlements) {
        if (resumePending) {
            return 0;
        }
        if (this.callbackEpoch == 0L || this.callbackEpoch != callbackEpoch) {
            return 0;
        }
        boolean reportedDramaMatches = dramaId == 0L || dramaId == this.dramaId;
        boolean reportedEpisodeMatches = reportedEpisode == 0
                || reportedEpisode == this.episode;
        boolean mayResume = reportedDramaMatches
                && reportedEpisodeMatches
                && serverEntitlements != null
                && serverEntitlements.contains(this.episode)
                && this.callbackEpoch == callbackEpoch;
        if (mayResume) {
            resumePending = true;
            return this.episode;
        }
        cancel();
        return 0;
    }

    /** Keeps DJX's terminal callback from finishing the host before its queued resume runs. */
    public synchronized boolean shouldSuppressTerminalFinish() {
        return resumePending;
    }

    /** Blocks a second SDK unlock from replacing an armed or resume-pending scope. */
    public synchronized boolean hasOutstandingResumeScope() {
        return callbackEpoch > 0L;
    }

    public synchronized boolean isPendingResume(long callbackEpoch, int episode) {
        return resumePending
                && this.callbackEpoch == callbackEpoch
                && this.episode == episode;
    }

    /** Clears terminal-finish suppression only after the replacement player is attached. */
    public synchronized boolean consumePendingResumeForAttachment(int episode) {
        if (!resumePending || this.episode != episode) {
            return false;
        }
        cancel();
        return true;
    }

    public synchronized void cancel() {
        callbackEpoch = 0L;
        dramaId = 0L;
        episode = 0;
        resumePending = false;
    }
}
