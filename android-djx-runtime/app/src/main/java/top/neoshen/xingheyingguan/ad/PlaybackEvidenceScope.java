package top.neoshen.xingheyingguan.ad;

import java.util.Map;

/** Correlates a real DJX video-play callback with one safe launch evidence scope. */
public final class PlaybackEvidenceScope {
    private static final String NONE = "<none>";

    private final long dramaId;
    private final int episode;
    private final String sessionRef;
    private final String showRef;

    public PlaybackEvidenceScope(long dramaId, int episode, String sessionRef, String showRef) {
        if (dramaId <= 0L || episode <= 0) {
            throw new IllegalArgumentException("Invalid playback evidence scope");
        }
        if (!isSafeReference(sessionRef) || !isSafeReference(showRef)
                || NONE.equals(sessionRef) != NONE.equals(showRef)) {
            throw new IllegalArgumentException("Invalid playback evidence reference");
        }
        this.dramaId = dramaId;
        this.episode = episode;
        this.sessionRef = sessionRef;
        this.showRef = showRef;
    }

    public boolean matchesTargetVideo(Map<String, Object> evidence) {
        if (evidence == null) {
            return false;
        }
        return exactLong(evidence.get("drama_id"), dramaId)
                && exactLong(evidence.get("index"), episode);
    }

    public String playingEvidence() {
        return "PLAYER_PLAYING dramaId=" + dramaId
                + " episode=" + episode
                + " sessionRef=" + sessionRef
                + " showRef=" + showRef;
    }

    public String requestFailureEvidence(int code) {
        return "PLAYER_REQUEST_FAILED dramaId=" + dramaId
                + " episode=" + episode
                + " sessionRef=" + sessionRef
                + " showRef=" + showRef
                + " code=" + code;
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

    private static boolean isSafeReference(String value) {
        return NONE.equals(value) || (value != null && value.matches("[0-9a-f]{12}"));
    }
}
