package top.neoshen.xingheyingguan;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PangleBootstrapOwnershipTest {

    @Test
    public void rejectsAReadySingletonThatThisBootstrapDidNotInitialize() {
        PangleBootstrapOwnership ownership = new PangleBootstrapOwnership();

        assertEquals(
                PangleBootstrapOwnership.Decision.REJECT_UNOWNED_READY,
                ownership.request(true).getDecision());
        assertFalse(ownership.completeSuccess(0));
        assertEquals(
                PangleBootstrapOwnership.Decision.REJECT_UNOWNED_READY,
                ownership.request(true).getDecision());
    }

    @Test
    public void reusesReadyStateOnlyAfterTheOwnedStartCompletesSuccessfully() {
        PangleBootstrapOwnership ownership = new PangleBootstrapOwnership();

        PangleBootstrapOwnership.Request owned = ownership.request(false);
        assertEquals(
                PangleBootstrapOwnership.Decision.START_OWNED,
                owned.getDecision());
        assertEquals(
                PangleBootstrapOwnership.Decision.JOIN_OWNED_START,
                ownership.request(true).getDecision());
        assertTrue(ownership.completeSuccess(owned.getAttempt()));
        assertEquals(
                PangleBootstrapOwnership.Decision.REUSE_OWNED,
                ownership.request(true).getDecision());
    }

    @Test
    public void ownedFailureCanRetryButLostGlobalReadyFailsClosed() {
        PangleBootstrapOwnership ownership = new PangleBootstrapOwnership();

        PangleBootstrapOwnership.Request first = ownership.request(false);
        assertEquals(
                PangleBootstrapOwnership.Decision.START_OWNED,
                first.getDecision());
        assertTrue(ownership.completeFailure(first.getAttempt()));
        PangleBootstrapOwnership.Request retry = ownership.request(false);
        assertEquals(
                PangleBootstrapOwnership.Decision.START_OWNED,
                retry.getDecision());
        assertFalse(ownership.completeSuccess(first.getAttempt()));
        assertTrue(ownership.completeSuccess(retry.getAttempt()));
        assertEquals(
                PangleBootstrapOwnership.Decision.REJECT_OWNED_STATE_LOST,
                ownership.request(false).getDecision());
    }
}
