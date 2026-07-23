package top.neoshen.xingheyingguan;

import java.util.regex.Pattern;

public final class AuthConsoleMessageFilter {
    private static final int MAX_LENGTH = 240;
    private static final Pattern SAFE_AUTH_MESSAGE =
            Pattern.compile(
                    "^\\[auth\\] (?:business-response|transport-response|session-verification"
                            + "|unknown) "
                            + "http=(?:[1-5][0-9]{2}|unknown) "
                            + "code=(?:unknown|AUTH_IDENTITY_MISMATCH|AUTH_SESSION_STALE"
                            + "|AUTH_SESSION_UNVERIFIED|[1-5][0-9]{2}) "
                            + "path=/(?:[A-Za-z_-]+/?){1,12}$");
    private static final Pattern SAFE_AD_UNLOCK_MESSAGE =
            Pattern.compile(
                    "^\\[ad-unlock\\] "
                            + "stage=(?:identity|consent|ownership|entitlements|session|native"
                            + "|verification|playback|unknown) "
                            + "code=(?:UNKNOWN|AUTH_IDENTITY_MISMATCH|AUTH_SESSION_STALE"
                            + "|AUTH_SESSION_UNVERIFIED|NATIVE_AD_FAILED|NATIVE_AD_NO_FILL"
                            + "|NATIVE_AD_TIMEOUT|NATIVE_AD_UNAVAILABLE|NATIVE_PROTOCOL_INVALID"
                            + "|PAGE_ASYNC_GUARD_INVALIDATED|PANGLE_INIT_FAILED"
                            + "|PRIVACY_CONSENT_DECLINED|PRIVACY_CONSENT_REQUIRED"
                            + "|REWARD_REJECTED|REWARD_VERIFY_TIMEOUT|STALE_PAGE_CONTEXT"
                            + "|TAKU_INIT_FAILED|TELEMETRY_DELIVERY_FAILED"
                            + "|TELEMETRY_RETRY_INVALID|[1-5][0-9]{2}"
                            + "|10300070(?:07|08|09|10|11|12))$");

    private AuthConsoleMessageFilter() {
    }

    public static String forLog(String message) {
        if (message == null
                || message.length() > MAX_LENGTH
                || (!SAFE_AUTH_MESSAGE.matcher(message).matches()
                && !SAFE_AD_UNLOCK_MESSAGE.matcher(message).matches())) {
            return null;
        }
        return message;
    }
}
