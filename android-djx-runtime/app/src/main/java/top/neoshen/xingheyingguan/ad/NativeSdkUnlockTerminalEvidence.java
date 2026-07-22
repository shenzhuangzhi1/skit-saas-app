package top.neoshen.xingheyingguan.ad;

import java.util.Map;

/** Distinguishes an omitted DJX terminal scope from malformed or mismatched evidence. */
public final class NativeSdkUnlockTerminalEvidence {
    public static final int ABSENT_EPISODE = 0;
    public static final int INVALID_EPISODE = -1;

    private NativeSdkUnlockTerminalEvidence() {
    }

    public static int reportedEpisode(Map<String, ? extends Object> evidence,
                                      long expectedDramaId) {
        if (expectedDramaId <= 0L) {
            throw new IllegalArgumentException("Invalid expected drama id");
        }
        if (evidence == null) {
            return ABSENT_EPISODE;
        }
        boolean hasDramaId = evidence.containsKey("drama_id");
        boolean hasEpisode = evidence.containsKey("index");
        if (!hasDramaId && !hasEpisode) {
            return ABSENT_EPISODE;
        }
        if (hasDramaId && !exactLong(evidence.get("drama_id"), expectedDramaId)) {
            return INVALID_EPISODE;
        }
        if (!hasEpisode) {
            return ABSENT_EPISODE;
        }
        Object value = evidence.get("index");
        if (!(value instanceof Number)) {
            return INVALID_EPISODE;
        }
        Number number = (Number) value;
        long episode = number.longValue();
        double doubleValue = number.doubleValue();
        if (!Double.isFinite(doubleValue) || doubleValue != (double) episode
                || episode <= 0L || episode > Integer.MAX_VALUE) {
            return INVALID_EPISODE;
        }
        return (int) episode;
    }

    private static boolean exactLong(Object value, long expected) {
        if (!(value instanceof Number)) {
            return false;
        }
        Number number = (Number) value;
        long candidate = number.longValue();
        double doubleValue = number.doubleValue();
        return Double.isFinite(doubleValue)
                && doubleValue == (double) candidate
                && candidate == expected;
    }
}
