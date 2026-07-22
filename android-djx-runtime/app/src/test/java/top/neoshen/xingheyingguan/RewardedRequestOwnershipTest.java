package top.neoshen.xingheyingguan;

import org.junit.Test;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class RewardedRequestOwnershipTest {

    @Test
    public void cancelledBootstrapRequestCanBeTakenExactlyOnceWithItsProtocol() {
        RewardedRequestOwnership ownership = new RewardedRequestOwnership();
        AdSessionProtocol protocol = protocol("session_0123456789ABCD");

        ownership.begin("callback-1", protocol);
        assertTrue(ownership.isCurrent("callback-1"));

        RewardedRequestOwnership.Request cancelled = ownership.clearIfCurrent("callback-1");
        assertEquals("callback-1", cancelled.getCallbackId());
        assertEquals(protocol, cancelled.getProtocol());
        assertNull(ownership.clearIfCurrent("callback-1"));
        assertFalse(ownership.isCurrent("callback-1"));
    }

    @Test
    public void staleCompletionCannotClearAReplacementRequest() {
        RewardedRequestOwnership ownership = new RewardedRequestOwnership();
        ownership.begin("callback-1", protocol("session_0123456789ABCD"));
        ownership.clearIfCurrent("callback-1");
        ownership.begin("callback-2", protocol("session_1123456789ABCD"));

        assertNull(ownership.clearIfCurrent("callback-1"));
        assertTrue(ownership.isCurrent("callback-2"));
    }

    @Test
    public void overlappingRequestsAreRejectedUntilTheOwnerTerminates() {
        RewardedRequestOwnership ownership = new RewardedRequestOwnership();
        ownership.begin("callback-1", protocol("session_0123456789ABCD"));

        assertThrows(IllegalStateException.class,
                () -> ownership.begin("callback-2", protocol("session_1123456789ABCD")));

        ownership.clear();
        ownership.begin("callback-2", protocol("session_1123456789ABCD"));
        assertTrue(ownership.isCurrent("callback-2"));
    }

    private static AdSessionProtocol protocol(String sessionId) {
        return new AdSessionProtocol(
                1,
                sessionId,
                "TAKU",
                "placement-1",
                "member-1",
                "custom-token-0123456789",
                "drama_unlock");
    }
}
