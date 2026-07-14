package top.neoshen.xingheyingguan.update;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.regex.Pattern;

public final class RuntimeUpdateManifest {
    private static final Pattern SCOPE = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

    private final String tenantId;
    private final String applicationId;
    private final String bundleUrl;
    private final String bundleSha256;
    private final int protocolVersion;
    private final long releaseNo;
    private final byte[] signature;

    public RuntimeUpdateManifest(String tenantId, String applicationId, String bundleUrl,
                                 String bundleSha256, int protocolVersion, long releaseNo,
                                 byte[] signature) {
        this.tenantId = require(SCOPE, tenantId, "tenantId");
        this.applicationId = require(SCOPE, applicationId, "applicationId");
        if (!isHttps(bundleUrl)) {
            throw new IllegalArgumentException("Runtime update URL must use HTTPS");
        }
        this.bundleUrl = bundleUrl;
        this.bundleSha256 = require(SHA256, bundleSha256, "bundleSha256");
        if (protocolVersion <= 0 || releaseNo <= 0) {
            throw new IllegalArgumentException("Invalid runtime update version metadata");
        }
        this.protocolVersion = protocolVersion;
        this.releaseNo = releaseNo;
        this.signature = signature == null ? new byte[0] : signature.clone();
    }

    public RuntimeUpdateManifest withSignature(byte[] newSignature) {
        return new RuntimeUpdateManifest(tenantId, applicationId, bundleUrl, bundleSha256,
                protocolVersion, releaseNo, newSignature);
    }

    public byte[] canonicalBytes() {
        String canonical = "SKIT_RUNTIME_UPDATE_V1\n"
                + "tenantId=" + tenantId + '\n'
                + "applicationId=" + applicationId + '\n'
                + "bundleSha256=" + bundleSha256 + '\n'
                + "protocolVersion=" + protocolVersion + '\n'
                + "releaseNo=" + releaseNo + '\n';
        return canonical.getBytes(StandardCharsets.UTF_8);
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getBundleUrl() {
        return bundleUrl;
    }

    public String getBundleSha256() {
        return bundleSha256;
    }

    public int getProtocolVersion() {
        return protocolVersion;
    }

    public long getReleaseNo() {
        return releaseNo;
    }

    public byte[] getSignature() {
        return signature.clone();
    }

    private static String require(Pattern pattern, String value, String field) {
        if (value == null || !pattern.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid " + field);
        }
        return value;
    }

    private static boolean isHttps(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getUserInfo() == null && uri.getFragment() == null;
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    @Override
    public String toString() {
        return "RuntimeUpdateManifest{tenantId='" + tenantId + '\''
                + ", applicationId='" + applicationId + '\''
                + ", bundleUrl='" + bundleUrl + '\''
                + ", bundleSha256='" + bundleSha256 + '\''
                + ", protocolVersion=" + protocolVersion
                + ", releaseNo=" + releaseNo + ", signature=<redacted>}";
    }
}
