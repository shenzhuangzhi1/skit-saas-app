package top.neoshen.xingheyingguan.ad;

import java.util.List;

/**
 * One-shot, episode-scoped native unlock policy.
 *
 * <p>The web layer and Activity Intent are untrusted policy inputs. Native playback therefore
 * always starts with no free episodes and requests exactly one episode per rewarded-ad flow.
 * A flow can be consumed only by a fresh server entitlement for its exact drama and episode.
 */
public final class NativeEpisodeUnlockPolicy {
    public static final int FREE_SET = 0;
    public static final int LOCK_SET = 1;

    private long nextGeneration;
    private long activeGeneration;
    private long activeDramaId;
    private int activeEpisodeNo;

    public synchronized long begin(long dramaId, int episodeNo) {
        if (dramaId <= 0L || episodeNo <= 0) {
            throw new IllegalArgumentException("Invalid native episode unlock scope");
        }
        nextGeneration++;
        if (nextGeneration <= 0L) {
            nextGeneration = 1L;
        }
        activeGeneration = nextGeneration;
        activeDramaId = dramaId;
        activeEpisodeNo = episodeNo;
        return activeGeneration;
    }

    public synchronized boolean isActive(long generation, long dramaId, int episodeNo) {
        return generation > 0L
                && generation == activeGeneration
                && dramaId == activeDramaId
                && episodeNo == activeEpisodeNo;
    }

    public synchronized boolean consumeIfEntitled(long generation, long dramaId, int episodeNo,
                                                   List<Integer> grantedEpisodes) {
        if (!isActive(generation, dramaId, episodeNo)
                || grantedEpisodes == null
                || !grantedEpisodes.contains(episodeNo)) {
            return false;
        }
        clear();
        return true;
    }

    public synchronized void cancel(long generation) {
        if (generation > 0L && generation == activeGeneration) {
            clear();
        }
    }

    private void clear() {
        activeGeneration = 0L;
        activeDramaId = 0L;
        activeEpisodeNo = 0;
    }
}
