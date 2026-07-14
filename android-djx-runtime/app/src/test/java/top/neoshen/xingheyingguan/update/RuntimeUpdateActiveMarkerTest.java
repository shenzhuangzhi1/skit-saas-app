package top.neoshen.xingheyingguan.update;

import org.junit.Before;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class RuntimeUpdateActiveMarkerTest {

    private KeyPair keyPair;
    private RuntimeUpdateManifestVerifier verifier;

    @Before
    public void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        verifier = new RuntimeUpdateManifestVerifier(
                keyPair.getPublic().getEncoded(), "tenant-11", "com.example.agent", 1);
    }

    @Test
    public void roundTripsEverySignedActiveReleaseField() throws Exception {
        RuntimeUpdateManifest signed = signedManifest(42L);

        RuntimeUpdateManifest decoded = RuntimeUpdateActiveMarker.decode(
                RuntimeUpdateActiveMarker.encode(signed));

        assertEquals(42L, verifier.verifyActive(decoded).getReleaseNo());
        assertEquals(signed.getTenantId(), decoded.getTenantId());
        assertEquals(signed.getApplicationId(), decoded.getApplicationId());
        assertEquals(signed.getBundleSha256(), decoded.getBundleSha256());
        assertEquals(signed.getProtocolVersion(), decoded.getProtocolVersion());
    }

    @Test
    public void tamperingWithMarkerReleaseIsRejectedByTheEmbeddedSignature() throws Exception {
        byte[] encoded = RuntimeUpdateActiveMarker.encode(signedManifest(42L));
        String tampered = new String(encoded, StandardCharsets.UTF_8)
                .replace("releaseNo=42\n", "releaseNo=43\n");

        RuntimeUpdateManifest decoded = RuntimeUpdateActiveMarker.decode(
                tampered.getBytes(StandardCharsets.UTF_8));

        assertThrows(SecurityException.class, () -> verifier.verifyActive(decoded));
    }

    @Test
    public void rejectsTruncatedExtraAndNonCanonicalMarkers() throws Exception {
        String encoded = new String(
                RuntimeUpdateActiveMarker.encode(signedManifest(42L)), StandardCharsets.UTF_8);

        assertThrows(IllegalArgumentException.class, () -> RuntimeUpdateActiveMarker.decode(
                encoded.substring(0, encoded.length() - 1).getBytes(StandardCharsets.UTF_8)));
        assertThrows(IllegalArgumentException.class, () -> RuntimeUpdateActiveMarker.decode(
                (encoded + "extra=value\n").getBytes(StandardCharsets.UTF_8)));
        assertThrows(IllegalArgumentException.class, () -> RuntimeUpdateActiveMarker.decode(
                encoded.replace("\n", "\r\n").getBytes(StandardCharsets.UTF_8)));
    }

    private RuntimeUpdateManifest signedManifest(long releaseNo) throws Exception {
        RuntimeUpdateManifest unsigned = new RuntimeUpdateManifest(
                "tenant-11",
                "com.example.agent",
                "https://updates.example.com/runtime.zip",
                repeat('a', 64),
                1,
                releaseNo,
                new byte[0]);
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(keyPair.getPrivate());
        signer.update(unsigned.canonicalBytes());
        return unsigned.withSignature(signer.sign());
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int i = 0; i < count; i++) {
            result.append(value);
        }
        return result.toString();
    }
}
