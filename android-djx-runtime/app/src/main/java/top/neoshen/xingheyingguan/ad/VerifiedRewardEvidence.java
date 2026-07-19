package top.neoshen.xingheyingguan.ad;

import java.util.regex.Pattern;

/**
 * A real rewarded-ad identity recovered from the server's signed callback provenance.
 *
 * <p>This type deliberately accepts no local marker or hashed identifier. H5 only supplies
 * non-reversible references; the raw pair is obtained from the player-grant-scoped API.
 */
public final class VerifiedRewardEvidence {
    private static final Pattern SESSION = Pattern.compile("[A-Za-z0-9_-]{22}");
    private static final Pattern SHOW = Pattern.compile("[A-Za-z0-9._:/-]{1,128}");

    private final String sessionId;
    private final String providerShowId;

    public VerifiedRewardEvidence(String sessionId, String providerShowId) {
        if (sessionId == null || !SESSION.matcher(sessionId).matches()
                || providerShowId == null || !SHOW.matcher(providerShowId).matches()) {
            throw new IllegalArgumentException("Invalid verified reward evidence");
        }
        this.sessionId = sessionId;
        this.providerShowId = providerShowId;
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getProviderShowId() {
        return providerShowId;
    }

    public boolean matches(String expectedSessionId, String expectedProviderShowId) {
        return sessionId.equals(expectedSessionId) && providerShowId.equals(expectedProviderShowId);
    }

    public boolean matches(PlaybackEvidenceScope launchScope) {
        return launchScope != null
                && launchScope.matchesVerifiedReward(sessionId, providerShowId);
    }

    @Override
    public String toString() {
        return "VerifiedRewardEvidence{sessionId=<redacted>, providerShowId=<redacted>}";
    }
}
