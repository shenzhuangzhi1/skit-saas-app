package top.neoshen.xingheyingguan.update;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;

public final class RuntimeUpdateManifestVerifier {
    private final PublicKey publicKey;
    private final String expectedTenantId;
    private final String expectedApplicationId;
    private final int expectedProtocolVersion;

    public RuntimeUpdateManifestVerifier(byte[] encodedPublicKey, String expectedTenantId,
                                         String expectedApplicationId, int expectedProtocolVersion) {
        if (encodedPublicKey == null || encodedPublicKey.length == 0) {
            throw new IllegalStateException("Runtime update public key is missing");
        }
        try {
            PublicKey candidate = KeyFactory.getInstance("RSA")
                    .generatePublic(new X509EncodedKeySpec(encodedPublicKey.clone()));
            if (!(candidate instanceof RSAPublicKey)
                    || ((RSAPublicKey) candidate).getModulus().bitLength() < 2048) {
                throw new IllegalArgumentException("RSA public key must be at least 2048 bits");
            }
            publicKey = candidate;
        } catch (Exception invalidKey) {
            throw new IllegalStateException("Runtime update public key is invalid", invalidKey);
        }
        if (expectedTenantId == null || expectedTenantId.length() == 0
                || expectedApplicationId == null || expectedApplicationId.length() == 0
                || expectedProtocolVersion <= 0) {
            throw new IllegalStateException("Runtime update build scope is incomplete");
        }
        this.expectedTenantId = expectedTenantId;
        this.expectedApplicationId = expectedApplicationId;
        this.expectedProtocolVersion = expectedProtocolVersion;
    }

    public RuntimeUpdateManifest verify(RuntimeUpdateManifest manifest,
                                        long highestAcceptedRelease) {
        if (manifest == null) {
            throw new SecurityException("Runtime update manifest is missing");
        }
        if (!expectedTenantId.equals(manifest.getTenantId())
                || !expectedApplicationId.equals(manifest.getApplicationId())
                || expectedProtocolVersion != manifest.getProtocolVersion()) {
            throw new SecurityException("Runtime update scope does not match this APK");
        }
        if (manifest.getReleaseNo() <= highestAcceptedRelease) {
            throw new SecurityException("Runtime update rollback or replay rejected");
        }
        byte[] signatureBytes = manifest.getSignature();
        if (signatureBytes.length == 0) {
            throw new SecurityException("Runtime update signature is missing");
        }
        try {
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(publicKey);
            signature.update(manifest.canonicalBytes());
            if (!signature.verify(signatureBytes)) {
                throw new SecurityException("Runtime update signature is invalid");
            }
        } catch (SecurityException invalidSignature) {
            throw invalidSignature;
        } catch (Exception verificationFailure) {
            throw new SecurityException("Runtime update signature could not be verified",
                    verificationFailure);
        }
        return manifest;
    }
}
