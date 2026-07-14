package top.neoshen.xingheyingguan.update;

import java.nio.charset.StandardCharsets;

/** Strict codec for the signed manifest stored inside an active runtime directory. */
public final class RuntimeUpdateActiveMarker {
    public static final String FILE_NAME = ".skit-runtime-release";

    private static final String MAGIC = "SKIT_RUNTIME_ACTIVE_V1";
    private static final String ACTIVE_BUNDLE_URL = "https://active.invalid/runtime.zip";
    private static final int MAX_MARKER_BYTES = 4096;

    private RuntimeUpdateActiveMarker() {
    }

    public static byte[] encode(RuntimeUpdateManifest manifest) {
        if (manifest == null || manifest.getSignature().length < 256) {
            throw new IllegalArgumentException("Verified runtime manifest is required");
        }
        String marker = MAGIC + '\n'
                + "tenantId=" + manifest.getTenantId() + '\n'
                + "applicationId=" + manifest.getApplicationId() + '\n'
                + "bundleSha256=" + manifest.getBundleSha256() + '\n'
                + "protocolVersion=" + manifest.getProtocolVersion() + '\n'
                + "releaseNo=" + manifest.getReleaseNo() + '\n'
                + "signatureHex=" + toHex(manifest.getSignature()) + '\n';
        byte[] encoded = marker.getBytes(StandardCharsets.UTF_8);
        if (encoded.length > MAX_MARKER_BYTES) {
            throw new IllegalArgumentException("Runtime active marker is too large");
        }
        return encoded;
    }

    public static RuntimeUpdateManifest decode(byte[] encoded) {
        if (encoded == null || encoded.length == 0 || encoded.length > MAX_MARKER_BYTES) {
            throw new IllegalArgumentException("Runtime active marker size is invalid");
        }
        String marker = new String(encoded, StandardCharsets.UTF_8);
        if (marker.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("Runtime active marker is not canonical");
        }
        String[] lines = marker.split("\n", -1);
        if (lines.length != 8 || !MAGIC.equals(lines[0]) || !lines[7].isEmpty()) {
            throw new IllegalArgumentException("Runtime active marker format is invalid");
        }
        String tenantId = value(lines[1], "tenantId=");
        String applicationId = value(lines[2], "applicationId=");
        String bundleSha256 = value(lines[3], "bundleSha256=");
        int protocolVersion = parsePositiveInt(value(lines[4], "protocolVersion="));
        long releaseNo = parsePositiveLong(value(lines[5], "releaseNo="));
        byte[] signature = fromHex(value(lines[6], "signatureHex="));
        if (signature.length < 256) {
            throw new IllegalArgumentException("Runtime active marker signature is invalid");
        }
        return new RuntimeUpdateManifest(
                tenantId,
                applicationId,
                ACTIVE_BUNDLE_URL,
                bundleSha256,
                protocolVersion,
                releaseNo,
                signature);
    }

    private static String value(String line, String prefix) {
        if (!line.startsWith(prefix) || line.length() == prefix.length()) {
            throw new IllegalArgumentException("Runtime active marker field is invalid");
        }
        return line.substring(prefix.length());
    }

    private static int parsePositiveInt(String value) {
        if (!value.matches("[1-9][0-9]{0,9}")) {
            throw new IllegalArgumentException("Runtime active protocol is invalid");
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException("Runtime active protocol is invalid", invalid);
        }
    }

    private static long parsePositiveLong(String value) {
        if (!value.matches("[1-9][0-9]{0,18}")) {
            throw new IllegalArgumentException("Runtime active release is invalid");
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException("Runtime active release is invalid", invalid);
        }
    }

    private static String toHex(byte[] bytes) {
        char[] hex = new char[bytes.length * 2];
        char[] alphabet = "0123456789abcdef".toCharArray();
        for (int index = 0; index < bytes.length; index++) {
            int value = bytes[index] & 0xff;
            hex[index * 2] = alphabet[value >>> 4];
            hex[index * 2 + 1] = alphabet[value & 0x0f];
        }
        return new String(hex);
    }

    private static byte[] fromHex(String value) {
        if (value.length() < 512 || value.length() > 2048 || value.length() % 2 != 0
                || !value.matches("[0-9a-f]+")) {
            throw new IllegalArgumentException("Runtime active marker signature is invalid");
        }
        byte[] bytes = new byte[value.length() / 2];
        for (int index = 0; index < bytes.length; index++) {
            int high = Character.digit(value.charAt(index * 2), 16);
            int low = Character.digit(value.charAt(index * 2 + 1), 16);
            bytes[index] = (byte) ((high << 4) | low);
        }
        return bytes;
    }
}
