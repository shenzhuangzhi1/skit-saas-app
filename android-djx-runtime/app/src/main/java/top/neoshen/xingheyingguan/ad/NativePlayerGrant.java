package top.neoshen.xingheyingguan.ad;

import java.util.regex.Pattern;

/** A short-lived opaque capability. Server validation remains authoritative. */
public final class NativePlayerGrant {
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final long grantId;
    private final long dramaId;
    private final String grantToken;
    private final long expiresAtEpochMillis;

    public NativePlayerGrant(long grantId, long dramaId, String grantToken,
                             long expiresAtEpochMillis, long nowEpochMillis) {
        if (grantId <= 0 || dramaId <= 0) {
            throw new IllegalArgumentException("Invalid player grant scope");
        }
        if (grantToken == null || !TOKEN.matcher(grantToken).matches()) {
            throw new IllegalArgumentException("Invalid player grant token");
        }
        if (expiresAtEpochMillis <= nowEpochMillis) {
            throw new IllegalArgumentException("Player grant is expired");
        }
        this.grantId = grantId;
        this.dramaId = dramaId;
        this.grantToken = grantToken;
        this.expiresAtEpochMillis = expiresAtEpochMillis;
    }

    public void requireDrama(long expectedDramaId) {
        if (expectedDramaId != dramaId) {
            throw new IllegalArgumentException("Player grant is bound to another drama");
        }
    }

    public long getGrantId() {
        return grantId;
    }

    public long getDramaId() {
        return dramaId;
    }

    public String getGrantToken() {
        return grantToken;
    }

    public long getExpiresAtEpochMillis() {
        return expiresAtEpochMillis;
    }

    @Override
    public String toString() {
        return "NativePlayerGrant{grantId=" + grantId + ", dramaId=" + dramaId
                + ", grantToken=<redacted>, expiresAtEpochMillis=" + expiresAtEpochMillis + '}';
    }
}
