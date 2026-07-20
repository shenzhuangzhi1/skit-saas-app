package top.neoshen.xingheyingguan;

import org.junit.Test;

import java.io.IOException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

public class SkitNativeApiClientSessionStatusTest {

    private static final String SESSION_ID = "abcdefghijklmnopqrstuv";

    @Test
    public void parsesValidatedClientLifecycleStatus() throws Exception {
        SkitNativeApiClient.SessionStatus parsed =
                SkitNativeApiClient.parseSessionStatus(
                        SESSION_ID, "LOAD_EXPIRED", "REJECTED", "NONE", "");

        assertEquals(SESSION_ID, parsed.getSessionId());
        assertEquals("LOAD_EXPIRED", parsed.getClientLifecycleStatus());
        assertEquals("REJECTED", parsed.getRewardVerificationStatus());
        assertEquals("NONE", parsed.getEntitlementStatus());
        assertNull(parsed.getProviderShowId());
    }

    @Test
    public void rejectsMissingOrUnknownClientLifecycleStatus() throws Exception {
        assertThrows(IOException.class, () -> SkitNativeApiClient.parseSessionStatus(
                SESSION_ID, "", "REJECTED", "NONE", ""));
        assertThrows(IOException.class, () -> SkitNativeApiClient.parseSessionStatus(
                SESSION_ID, "ORPHANED", "REJECTED", "NONE", ""));
    }
}
