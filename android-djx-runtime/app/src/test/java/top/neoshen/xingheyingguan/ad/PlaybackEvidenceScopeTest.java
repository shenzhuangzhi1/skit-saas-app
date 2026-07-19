package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PlaybackEvidenceScopeTest {

    @Test
    public void acceptsOnlyTheExactDramaAndEpisodeReportedByTheRealPlayCallback() {
        PlaybackEvidenceScope scope = new PlaybackEvidenceScope(
                3474L, 1, "f69f9b70d1c9", "f5a47f4a915c");

        assertTrue(scope.matchesTargetVideo(video(3474L, 1)));
        assertFalse(scope.matchesTargetVideo(video(3474L, 2)));
        assertFalse(scope.matchesTargetVideo(video(9999L, 1)));
        assertFalse(scope.matchesTargetVideo(new HashMap<String, Object>()));
        assertFalse(scope.matchesTargetVideo(null));
    }

    @Test
    public void emitsOnlySafeScopeBoundSuccessAndFailureEvidence() {
        PlaybackEvidenceScope scope = new PlaybackEvidenceScope(
                3474L, 1, "f69f9b70d1c9", "f5a47f4a915c");

        assertTrue(scope.playingEvidence().equals(
                "PLAYER_PLAYING dramaId=3474 episode=1 sessionRef=f69f9b70d1c9 showRef=f5a47f4a915c"));
        assertTrue(scope.requestFailureEvidence(-3).equals(
                "PLAYER_REQUEST_FAILED dramaId=3474 episode=1 sessionRef=f69f9b70d1c9 showRef=f5a47f4a915c code=-3"));
    }

    @Test
    public void matchesOnlyTheRawServerPairBehindTheSafeLaunchReferences() {
        PlaybackEvidenceScope scope = new PlaybackEvidenceScope(
                3474L, 1, "f69f9b70d1c9", "f5a47f4a915c");

        assertTrue(scope.matchesVerifiedReward(
                "abcdefghijklmnopqrstuv", "taku-show-20260719"));
        assertFalse(scope.matchesVerifiedReward(
                "abcdefghijklmnopqrstuv", "different-show"));
        assertFalse(scope.matchesVerifiedReward(
                "session_0123456789ABCD", "taku-show-20260719"));
        assertFalse(scope.matchesVerifiedReward("not a session", "taku-show-20260719"));

        PlaybackEvidenceScope noLaunchEvidence = new PlaybackEvidenceScope(
                3474L, 1, "<none>", "<none>");
        assertTrue(noLaunchEvidence.matchesVerifiedReward(
                "abcdefghijklmnopqrstuv", "taku-show-20260719"));
    }

    private static Map<String, Object> video(long dramaId, int episode) {
        Map<String, Object> values = new HashMap<>();
        values.put("drama_id", dramaId);
        values.put("index", episode);
        return values;
    }
}
