package top.neoshen.xingheyingguan.ad;

import java.util.Collection;

/**
 * Carries one server-authorized episode across DJX's asynchronous unlock completion callback.
 */
public final class NativeSdkUnlockResumePolicy {
    private long callbackEpoch;
    private long dramaId;
    private int episode;

    public void arm(long callbackEpoch, long dramaId, int episode) {
        if (callbackEpoch <= 0L || dramaId <= 0L || episode <= 0) {
            throw new IllegalArgumentException("Invalid DJX resume scope");
        }
        this.callbackEpoch = callbackEpoch;
        this.dramaId = dramaId;
        this.episode = episode;
    }

    /**
     * Returns the exact episode to resume only when the server entitlement is present.
     * DJX's custom-ad completion status is advisory and may report an ad error after the
     * signed reward has already granted the episode.
     */
    public int completeWithServerEntitlements(long callbackEpoch, long dramaId,
                                              int reportedEpisode,
                                              Collection<Integer> serverEntitlements) {
        boolean reportedEpisodeMatches = reportedEpisode == 0
                || reportedEpisode == this.episode;
        int resumeEpisode = reportedEpisodeMatches
                && serverEntitlements != null
                && serverEntitlements.contains(this.episode)
                && this.callbackEpoch == callbackEpoch
                && this.dramaId == dramaId
                ? this.episode : 0;
        cancel();
        return resumeEpisode;
    }

    public void cancel() {
        callbackEpoch = 0L;
        dramaId = 0L;
        episode = 0;
    }
}
