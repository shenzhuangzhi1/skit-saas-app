package top.neoshen.xingheyingguan.ad;

import java.util.Objects;
import java.util.regex.Pattern;

/** Immutable copy of the server-issued protocol used for exactly one Taku ad instance. */
public final class AdSessionProtocol {
    public static final int SUPPORTED_VERSION = 1;
    public static final String SUPPORTED_PROVIDER = "TAKU";
    public static final String SUPPORTED_SCENE = "drama_unlock";

    private static final Pattern SESSION = Pattern.compile("[A-Za-z0-9_-]{22}");
    private static final Pattern SAFE_TEXT = Pattern.compile("[A-Za-z0-9._:/-]{1,128}");
    private static final Pattern CUSTOM_DATA = Pattern.compile("[A-Za-z0-9_-]{22,256}");

    private final int protocolVersion;
    private final String sessionId;
    private final String provider;
    private final String placementId;
    private final String userId;
    private final String customData;
    private final String scene;

    public AdSessionProtocol(int protocolVersion, String sessionId, String provider,
                             String placementId, String userId, String customData, String scene) {
        if (protocolVersion != SUPPORTED_VERSION) {
            throw new IllegalArgumentException("Unsupported native ad protocol version");
        }
        this.sessionId = require(SESSION, sessionId, "sessionId");
        if (!SUPPORTED_PROVIDER.equals(provider)) {
            throw new IllegalArgumentException("Unsupported native ad provider");
        }
        this.provider = provider;
        this.placementId = require(SAFE_TEXT, placementId, "placementId");
        this.userId = require(SAFE_TEXT, userId, "userId");
        this.customData = require(CUSTOM_DATA, customData, "customData");
        if (!SUPPORTED_SCENE.equals(scene)) {
            throw new IllegalArgumentException("Unsupported native ad scene");
        }
        this.scene = scene;
        this.protocolVersion = protocolVersion;
    }

    public int getProtocolVersion() {
        return protocolVersion;
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getProvider() {
        return provider;
    }

    public String getPlacementId() {
        return placementId;
    }

    public String getUserId() {
        return userId;
    }

    public String getCustomData() {
        return customData;
    }

    public String getScene() {
        return scene;
    }

    private static String require(Pattern pattern, String value, String name) {
        Objects.requireNonNull(pattern, "pattern");
        if (value == null || !pattern.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid " + name);
        }
        return value;
    }

    @Override
    public String toString() {
        return "AdSessionProtocol{protocolVersion=" + protocolVersion
                + ", sessionId='" + sessionId + '\''
                + ", provider='" + provider + '\''
                + ", placementId='" + placementId + '\''
                + ", userId='" + userId + '\''
                + ", customData=<redacted>, scene='" + scene + "'}";
    }
}
