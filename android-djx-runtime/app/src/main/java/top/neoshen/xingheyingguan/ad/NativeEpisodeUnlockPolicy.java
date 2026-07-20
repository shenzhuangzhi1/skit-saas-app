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

    public enum Decision {
        ALLOW,
        REQUIRE_AD,
        WAIT,
        CONFLICT
    }

    public static final class AccessRequest {
        private final Decision decision;
        private final long generation;

        private AccessRequest(Decision decision, long generation) {
            this.decision = decision;
            this.generation = generation;
        }

        public Decision getDecision() {
            return decision;
        }

        public long getGeneration() {
            return generation;
        }
    }

    private long nextGeneration;
    private long activeGeneration;
    private long activeDramaId;
    private int activeEpisodeNo;

    /**
     * Evaluates every native player page boundary against the server entitlement snapshot.
     * DJX's own episode status is intentionally not playback authority.
     */
    public synchronized AccessRequest request(long dramaId, int episodeNo,
                                              List<Integer> grantedEpisodes) {
        requireValidScope(dramaId, episodeNo);
        if (activeGeneration > 0L) {
            Decision decision = dramaId == activeDramaId && episodeNo == activeEpisodeNo
                    ? Decision.WAIT : Decision.CONFLICT;
            return new AccessRequest(decision, activeGeneration);
        }
        if (grantedEpisodes != null && grantedEpisodes.contains(episodeNo)) {
            return new AccessRequest(Decision.ALLOW, 0L);
        }
        return new AccessRequest(Decision.REQUIRE_AD, begin(dramaId, episodeNo));
    }

    public synchronized long begin(long dramaId, int episodeNo) {
        requireValidScope(dramaId, episodeNo);
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

    private static void requireValidScope(long dramaId, int episodeNo) {
        if (dramaId <= 0L || episodeNo <= 0) {
            throw new IllegalArgumentException("Invalid native episode unlock scope");
        }
    }
}
