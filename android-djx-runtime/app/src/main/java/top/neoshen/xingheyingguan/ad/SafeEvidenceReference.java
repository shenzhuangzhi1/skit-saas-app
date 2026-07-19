package top.neoshen.xingheyingguan.ad;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Produces a non-reversible short reference for correlating local evidence safely. */
public final class SafeEvidenceReference {
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private SafeEvidenceReference() {
    }

    public static String of(String identifier) {
        if (identifier == null) {
            return "<none>";
        }
        final byte[] digest;
        try {
            digest = MessageDigest.getInstance("SHA-256")
                    .digest(identifier.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 is unavailable", unavailable);
        }
        char[] reference = new char[12];
        for (int index = 0; index < 6; index += 1) {
            int value = digest[index] & 0xff;
            reference[index * 2] = HEX[value >>> 4];
            reference[index * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(reference);
    }
}
