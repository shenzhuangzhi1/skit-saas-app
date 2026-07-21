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

    /** Returns the exact episode to resume, or zero when the completion cannot be trusted. */
    public int complete(long callbackEpoch, long dramaId, int episode, boolean successful) {
        int resumeEpisode = successful
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
