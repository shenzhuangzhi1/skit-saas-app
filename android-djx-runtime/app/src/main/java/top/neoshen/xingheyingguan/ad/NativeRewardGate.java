package top.neoshen.xingheyingguan.ad;

import java.util.regex.Pattern;

/** Converts only matching server facts into a native player grant decision. */
public final class NativeRewardGate {
    private static final Pattern SESSION = Pattern.compile("[A-Za-z0-9_-]{22}");
    private static final Pattern SHOW = Pattern.compile("[A-Za-z0-9._:/-]{1,128}");

    public enum Decision { WAIT, GRANT, REJECT }

    public static final class Evidence {
        private final String sessionId;
        private final String rewardVerificationStatus;
        private final String entitlementStatus;
        private final String providerShowId;

        public Evidence(String sessionId, String rewardVerificationStatus,
                        String entitlementStatus, String providerShowId) {
            this.sessionId = sessionId;
            this.rewardVerificationStatus = rewardVerificationStatus;
            this.entitlementStatus = entitlementStatus;
            this.providerShowId = providerShowId;
        }
    }

    private final String sessionId;
    private final String providerShowId;

    public NativeRewardGate(String sessionId, String providerShowId) {
        if (sessionId == null || !SESSION.matcher(sessionId).matches()
                || providerShowId == null || !SHOW.matcher(providerShowId).matches()) {
            throw new IllegalArgumentException("Invalid native reward scope");
        }
        this.sessionId = sessionId;
        this.providerShowId = providerShowId;
    }

    public Decision evaluate(Evidence evidence) {
        if (evidence == null || !sessionId.equals(evidence.sessionId)) {
            throw new SecurityException("Native reward evidence escaped its session scope");
        }
        if (evidence.providerShowId == null || evidence.providerShowId.length() == 0) {
            if ("SIGNED_VERIFIED".equals(evidence.rewardVerificationStatus)
                    || "GRANTED".equals(evidence.entitlementStatus)) {
                throw new SecurityException("Authoritative reward is missing its show identity");
            }
        } else if (!providerShowId.equals(evidence.providerShowId)) {
            throw new SecurityException("Native reward evidence escaped its show scope");
        }
        if ("SIGNED_VERIFIED".equals(evidence.rewardVerificationStatus)
                && "GRANTED".equals(evidence.entitlementStatus)) {
            return Decision.GRANT;
        }
        if ("REJECTED".equals(evidence.rewardVerificationStatus)
                || "VERIFY_TIMEOUT".equals(evidence.rewardVerificationStatus)
                || "SECURITY_REVOKED".equals(evidence.entitlementStatus)) {
            return Decision.REJECT;
        }
        return Decision.WAIT;
    }
}
