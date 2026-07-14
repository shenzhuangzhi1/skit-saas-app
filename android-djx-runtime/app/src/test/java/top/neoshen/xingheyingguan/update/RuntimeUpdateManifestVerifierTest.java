package top.neoshen.xingheyingguan.update;

import org.junit.Before;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class RuntimeUpdateManifestVerifierTest {

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
    public void acceptsSignatureBoundToEverySecurityField() throws Exception {
        RuntimeUpdateManifest unsigned = manifest(
                "tenant-11", "com.example.agent", repeat('a', 64), 1, 42L, new byte[0]);
        RuntimeUpdateManifest signed = unsigned.withSignature(sign(unsigned.canonicalBytes()));

        RuntimeUpdateManifest verified = verifier.verify(signed, 41L);

        assertEquals(42L, verified.getReleaseNo());
    }

    @Test
    public void rejectsInvalidSignatureAndEveryScopeSubstitution() throws Exception {
        RuntimeUpdateManifest unsigned = manifest(
                "tenant-11", "com.example.agent", repeat('a', 64), 1, 42L, new byte[0]);
        byte[] signature = sign(unsigned.canonicalBytes());
        assertThrows(SecurityException.class,
                () -> verifier.verify(unsigned.withSignature(new byte[] {1, 2, 3}), 41L));
        assertThrows(SecurityException.class, () -> verifier.verify(manifest(
                "tenant-12", "com.example.agent", repeat('a', 64), 1, 42L, signature), 41L));
        assertThrows(SecurityException.class, () -> verifier.verify(manifest(
                "tenant-11", "com.other.app", repeat('a', 64), 1, 42L, signature), 41L));
        assertThrows(SecurityException.class, () -> verifier.verify(manifest(
                "tenant-11", "com.example.agent", repeat('b', 64), 1, 42L, signature), 41L));
        assertThrows(SecurityException.class, () -> verifier.verify(manifest(
                "tenant-11", "com.example.agent", repeat('a', 64), 2, 42L, signature), 41L));
    }

    @Test
    public void rejectsRollbackAndReplay() throws Exception {
        RuntimeUpdateManifest unsigned = manifest(
                "tenant-11", "com.example.agent", repeat('a', 64), 1, 42L, new byte[0]);
        RuntimeUpdateManifest signed = unsigned.withSignature(sign(unsigned.canonicalBytes()));
        assertThrows(SecurityException.class, () -> verifier.verify(signed, 42L));
        assertThrows(SecurityException.class, () -> verifier.verify(signed, 43L));
    }

    @Test
    public void rejectsMissingEmbeddedPublicKey() {
        assertThrows(IllegalStateException.class,
                () -> new RuntimeUpdateManifestVerifier(new byte[0], "tenant-11", "com.example.agent", 1));
    }

    @Test
    public void rejectsRsaKeysSmallerThan2048Bits() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(1024);
        KeyPair weakKeyPair = generator.generateKeyPair();
        assertThrows(IllegalStateException.class, () -> new RuntimeUpdateManifestVerifier(
                weakKeyPair.getPublic().getEncoded(), "tenant-11", "com.example.agent", 1));
    }

    private byte[] sign(byte[] canonical) throws Exception {
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(keyPair.getPrivate());
        signer.update(canonical);
        return signer.sign();
    }

    private static RuntimeUpdateManifest manifest(String tenantId, String applicationId,
                                                   String sha256, int protocolVersion,
                                                   long releaseNo, byte[] signature) {
        return new RuntimeUpdateManifest(
                tenantId,
                applicationId,
                "https://updates.example.com/runtime.zip",
                sha256,
                protocolVersion,
                releaseNo,
                signature);
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int i = 0; i < count; i++) {
            result.append(value);
        }
        return result.toString();
    }
}
