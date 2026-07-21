package top.neoshen.xingheyingguan.ad;

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
    public int completeWithServerEntitlement(long callbackEpoch, long dramaId, int episode,
                                             boolean serverEntitled) {
        int resumeEpisode = serverEntitled
                && this.callbackEpoch == callbackEpoch
                && this.dramaId == dramaId
                && this.episode == episode
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
