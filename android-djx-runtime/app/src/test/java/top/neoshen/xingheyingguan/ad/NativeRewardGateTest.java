package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class NativeRewardGateTest {

    @Test
    public void grantsOnlyWhenSignedServerRewardAndEntitlementMatchTheObservedShow() {
        NativeRewardGate gate = new NativeRewardGate("session_0123456789ABCD", "show-1");
        assertEquals(NativeRewardGate.Decision.WAIT, gate.evaluate(
                evidence("PENDING", "NONE", "show-1")));
        assertEquals(NativeRewardGate.Decision.GRANT, gate.evaluate(
                evidence("SIGNED_VERIFIED", "GRANTED", "show-1")));
    }

    @Test
    public void rejectsTerminalServerFailuresAndCrossSessionOrCrossShowEvidence() {
        NativeRewardGate gate = new NativeRewardGate("session_0123456789ABCD", "show-1");
        assertEquals(NativeRewardGate.Decision.REJECT, gate.evaluate(
                evidence("REJECTED", "NONE", "show-1")));
        assertEquals(NativeRewardGate.Decision.REJECT, gate.evaluate(
                evidence("VERIFY_TIMEOUT", "NONE", "show-1")));
        assertThrows(SecurityException.class, () -> gate.evaluate(new NativeRewardGate.Evidence(
                "foreign_0123456789ABCDE", "SIGNED_VERIFIED", "GRANTED", "show-1")));
        assertThrows(SecurityException.class, () -> gate.evaluate(
                evidence("SIGNED_VERIFIED", "GRANTED", "show-2")));
    }

    @Test
    public void neverPromotesClientRewardObservationToAuthority() {
        NativeRewardGate gate = new NativeRewardGate("session_0123456789ABCD", "show-1");
        assertEquals(NativeRewardGate.Decision.WAIT, gate.evaluate(
                evidence("PENDING", "NONE", "show-1")));
    }

    private static NativeRewardGate.Evidence evidence(String reward, String entitlement,
                                                       String showId) {
        return new NativeRewardGate.Evidence(
                "session_0123456789ABCD", reward, entitlement, showId);
    }
}
