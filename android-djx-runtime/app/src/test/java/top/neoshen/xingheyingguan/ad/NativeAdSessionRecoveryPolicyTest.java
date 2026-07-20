package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NativeAdSessionRecoveryPolicyTest {

    @Test
    public void pollOnlyLoadExpiryCanReplaceItsSessionExactlyOncePerUnlock() {
        NativeAdSessionRecoveryPolicy policy = new NativeAdSessionRecoveryPolicy();
        policy.begin(41L);

        assertFalse(policy.consumeIfRecoverable(
                41L, false, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", null));
        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "FAILED", "REJECTED", null));
        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "VERIFY_TIMEOUT", null));
        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", "real-show-id"));

        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "different-session",
                "LOAD_EXPIRED", "REJECTED", null));

        assertTrue(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", null));
        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", null));
    }

    @Test
    public void recoveryBudgetIsBoundToTheCurrentUnlockGeneration() {
        NativeAdSessionRecoveryPolicy policy = new NativeAdSessionRecoveryPolicy();
        policy.begin(41L);
        assertTrue(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", null));

        policy.begin(42L);
        assertFalse(policy.consumeIfRecoverable(
                41L, true, "session-41", "session-41",
                "LOAD_EXPIRED", "REJECTED", null));
        assertTrue(policy.consumeIfRecoverable(
                42L, true, "session-42", "session-42",
                "LOAD_EXPIRED", "REJECTED", null));

        policy.cancel(42L);
        assertFalse(policy.consumeIfRecoverable(
                42L, true, "session-42", "session-42",
                "LOAD_EXPIRED", "REJECTED", null));
    }
}
