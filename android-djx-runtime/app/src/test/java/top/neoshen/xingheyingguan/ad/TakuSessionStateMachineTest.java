package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class TakuSessionStateMachineTest {

    private static final AdSessionProtocol PROTOCOL = new AdSessionProtocol(
            1,
            "session_0123456789ABCD",
            "TAKU",
            "tenant-placement-1",
            "opaque-member-1",
            "token_0123456789ABCDEFGH",
            "drama_unlock");

    @Test
    public void emitsStrictMonotonicEventsForOneSession() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");

        assertEquals(TakuNativeState.UNINITIALIZED, machine.getState());
        machine.initializing();
        assertEquals(TakuNativeState.INITIALIZING, machine.getState());
        assertEquals(TakuNativeState.LOADING, machine.loading().getState());
        assertEquals(TakuNativeState.LOADED, machine.loaded().getState());
        TakuTelemetry showing = machine.showing("show-1", 66, "source-1");
        assertEquals(2, showing.getCallbackSequence());
        assertEquals("show-1", showing.getProviderShowId());
        assertTrue(machine.rewardObserved("show-1", 66, "source-1").isClientRewardObserved());
        TakuTelemetry closed = machine.closed("show-1", 66, "source-1");
        assertTrue(closed.isClosed());
        assertTrue(closed.isClientRewardObserved());
    }

    @Test
    public void rejectsDuplicateOutOfOrderAndCrossShowCallbacks() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");
        assertThrows(IllegalStateException.class, machine::loaded);
        machine.loading();
        assertThrows(IllegalStateException.class, machine::loading);
        machine.loaded();
        machine.showing("show-1", 66, "source-1");
        assertThrows(IllegalStateException.class,
                () -> machine.rewardObserved("show-2", 66, "source-1"));
        machine.closed("show-1", 66, "source-1");
        assertThrows(IllegalStateException.class,
                () -> machine.rewardObserved("show-1", 66, "source-1"));
    }

    @Test
    public void failureNeverClaimsAReward() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");
        machine.loading();
        TakuTelemetry failure = machine.failed(null, null, null);
        assertEquals(TakuNativeState.ERROR, failure.getState());
        assertEquals(TakuFailureReason.SDK_FAILURE, failure.getFailureReason());
        assertFalse(failure.isClientRewardObserved());
        assertFalse(failure.isClosed());
    }

    @Test
    public void noFillIsAnExplicitTerminalReasonOnlyOnFailure() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");
        machine.loading();

        TakuTelemetry failure = machine.failed(
                null, null, null, TakuFailureReason.NO_FILL);

        assertEquals(TakuNativeState.ERROR, failure.getState());
        assertEquals(TakuFailureReason.NO_FILL, failure.getFailureReason());
        assertFalse(failure.isClientRewardObserved());
        assertFalse(failure.isClosed());
    }

    @Test
    public void failureAfterShowRetainsTheAuthoritativeShowIdentity() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");
        machine.loading();
        machine.loaded();
        machine.showing("show-1", 66, "source-1");

        TakuTelemetry failure = machine.failed(null, null, null);

        assertEquals("show-1", failure.getProviderShowId());
        assertEquals(Integer.valueOf(66), failure.getNetworkFirmId());
        assertEquals("source-1", failure.getAdsourceId());
    }

    @Test
    public void closeBeforeRewardIsAnExplicitUnrewardedTerminalEvent() {
        TakuSessionStateMachine machine = new TakuSessionStateMachine(PROTOCOL, "request-1");
        machine.initializing();
        machine.loading();
        machine.loaded();
        machine.showing("show-1", 66, "source-1");

        TakuTelemetry closed = machine.closed("show-1", 66, "source-1");

        assertEquals(TakuNativeState.CLOSED, closed.getState());
        assertFalse(closed.isClientRewardObserved());
        assertTrue(closed.isClosed());
        assertThrows(IllegalStateException.class,
                () -> machine.rewardObserved("show-1", 66, "source-1"));
    }
}
