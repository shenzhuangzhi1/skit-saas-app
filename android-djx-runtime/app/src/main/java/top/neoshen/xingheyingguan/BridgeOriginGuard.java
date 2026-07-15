package top.neoshen.xingheyingguan;

import android.net.Uri;

/** Allows native capabilities only to the exact loopback origin created by this process. */
final class BridgeOriginGuard {
    private final String expectedScheme;
    private final String expectedHost;
    private final int expectedPort;
    private volatile String currentTopLevelUrl;

    BridgeOriginGuard(String trustedBaseUrl) {
        Uri trusted = Uri.parse(trustedBaseUrl);
        expectedScheme = trusted.getScheme();
        expectedHost = trusted.getHost();
        expectedPort = trusted.getPort();
        if (!"http".equals(expectedScheme) || !"127.0.0.1".equals(expectedHost)
                || expectedPort <= 0) {
            throw new IllegalArgumentException("Native bridge origin must be exact loopback HTTP");
        }
    }

    boolean isTrustedTopLevel(String candidateUrl) {
        if (candidateUrl == null || candidateUrl.length() == 0) {
            return false;
        }
        Uri candidate = Uri.parse(candidateUrl);
        return expectedScheme.equals(candidate.getScheme())
                && expectedHost.equals(candidate.getHost())
                && expectedPort == candidate.getPort()
                && candidate.getUserInfo() == null;
    }

    String trustedOriginRule() {
        return expectedScheme + "://" + expectedHost + ":" + expectedPort;
    }

    boolean isTrustedMessageOrigin(Uri sourceOrigin) {
        return sourceOrigin != null
                && expectedScheme.equals(sourceOrigin.getScheme())
                && expectedHost.equals(sourceOrigin.getHost())
                && expectedPort == sourceOrigin.getPort()
                && sourceOrigin.getUserInfo() == null;
    }

    void updateTopLevel(String candidateUrl) {
        currentTopLevelUrl = candidateUrl;
    }

    void requireTrustedTopLevel() {
        if (!isTrustedTopLevel(currentTopLevelUrl)) {
            throw new SecurityException("Native bridge is unavailable for this top-level origin");
        }
    }
}
