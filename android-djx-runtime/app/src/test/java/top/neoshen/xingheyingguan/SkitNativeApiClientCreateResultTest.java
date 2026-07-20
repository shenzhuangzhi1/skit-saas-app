package top.neoshen.xingheyingguan;

import org.junit.Test;

import java.io.IOException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

public class SkitNativeApiClientCreateResultTest {

    private static final String SESSION_ID = "AbCdEfGhIjKlMnOpQrStUv";

    @Test
    public void verifyingWithoutCustomDataProducesPollOnlyReference() throws Exception {
        SkitNativeApiClient.CreateResult result = SkitNativeApiClient.parseCreateResult(
                "VERIFYING", 1, SESSION_ID, "TAKU", "placement-1",
                "member-1", "", "drama_unlock");

        assertEquals("VERIFYING", result.getOutcome());
        assertEquals(SESSION_ID, result.getSessionId());
        assertNull(result.getProtocol());
    }

    @Test
    public void createdStillRequiresTheServerIssuedCustomData() throws Exception {
        try {
            SkitNativeApiClient.parseCreateResult(
                    "CREATED", 1, SESSION_ID, "TAKU", "placement-1",
                    "member-1", "", "drama_unlock");
            fail("CREATED must not be accepted without a Taku customData token");
        } catch (IOException expected) {
            // Expected: only settlement polling may omit the one-time ad token.
        }
    }

    @Test
    public void verifyingRejectsNullProtocolMetadata() throws Exception {
        try {
            SkitNativeApiClient.parseCreateResult(
                    "VERIFYING", 1, SESSION_ID, "TAKU", null,
                    "member-1", "", "drama_unlock");
            fail("VERIFYING must reject missing placement metadata");
        } catch (IOException expected) {
            // Expected.
        }
    }
}
