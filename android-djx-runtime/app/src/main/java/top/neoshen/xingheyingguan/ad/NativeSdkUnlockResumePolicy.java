package top.neoshen.xingheyingguan.ad;

import java.util.Collection;

/**
 * Carries one server-authorized episode across DJX's asynchronous unlock completion callback.
 */
public final class NativeSdkUnlockResumePolicy {
    public static final int REJECTED_EPISODE = -1;

    private long callbackEpoch;
    private long dramaId;
    private int episode;
    private boolean terminalObserved;
    private boolean serverAuthorized;
    private boolean resumePending;

    /** Registers the exact SDK unlock before terminal and server callbacks can race. */
    public synchronized void begin(long callbackEpoch, long dramaId, int episode) {
        if (callbackEpoch <= 0L || dramaId <= 0L || episode <= 0) {
            throw new IllegalArgumentException("Invalid DJX resume scope");
        }
        if (this.callbackEpoch != 0L) {
            throw new IllegalStateException("DJX resume scope is already outstanding");
        }
        this.callbackEpoch = callbackEpoch;
        this.dramaId = dramaId;
        this.episode = episode;
        terminalObserved = false;
        serverAuthorized = false;
        resumePending = false;
    }

    /**
     * Records DJX's advisory terminal callback. A missing scope field may fall back to the
     * registered scope, but an explicit mismatch rejects the current unlock.
     */
    public synchronized int observeTerminal(
            long callbackEpoch, long reportedDramaId, int reportedEpisode) {
        if (this.callbackEpoch == 0L) {
            return REJECTED_EPISODE;
        }
        if (this.callbackEpoch != callbackEpoch) {
            return 0;
        }
        boolean reportedDramaMatches = reportedDramaId == 0L
                || reportedDramaId == this.dramaId;
        boolean reportedEpisodeMatches = reportedEpisode == 0
                || reportedEpisode == this.episode;
        if (!reportedDramaMatches || !reportedEpisodeMatches) {
            cancel();
            return REJECTED_EPISODE;
        }
        if (resumePending || terminalObserved) {
            return 0;
        }
        terminalObserved = true;
        return promoteIfReady();
    }

    /**
     * Records the authoritative server entitlement after signed provenance validation.
     * This is deliberately independent of terminal arrival order.
     */
    public synchronized int authorizeFromServer(
            long callbackEpoch, long dramaId,
            Collection<Integer> serverEntitlements) {
        if (this.callbackEpoch == 0L) {
            return REJECTED_EPISODE;
        }
        if (this.callbackEpoch != callbackEpoch) {
            return 0;
        }
        if (dramaId != this.dramaId || serverEntitlements == null
                || !serverEntitlements.contains(this.episode)) {
            cancel();
            return REJECTED_EPISODE;
        }
        if (resumePending || serverAuthorized) {
            return 0;
        }
        serverAuthorized = true;
        return promoteIfReady();
    }

    private int promoteIfReady() {
        if (terminalObserved && serverAuthorized) {
            resumePending = true;
            return episode;
        }
        return 0;
    }

    /** Keeps DJX from finishing the host while terminal and server events rendezvous. */
    public synchronized boolean shouldSuppressTerminalFinish() {
        return callbackEpoch > 0L;
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

    /** True only after exactly one side of the terminal/server rendezvous has arrived. */
    public synchronized boolean isWaitingForCounterpart(long callbackEpoch, int episode) {
        return !resumePending
                && this.callbackEpoch == callbackEpoch
                && this.episode == episode
                && terminalObserved != serverAuthorized;
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
        terminalObserved = false;
        serverAuthorized = false;
        resumePending = false;
    }
}
