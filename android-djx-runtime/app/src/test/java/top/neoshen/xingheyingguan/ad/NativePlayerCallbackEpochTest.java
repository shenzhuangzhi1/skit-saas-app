package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NativePlayerCallbackEpochTest {

    @Test
    public void replacingPlayerRejectsLateCallbacksFromPreviousWidget() {
        NativePlayerCallbackEpoch epochs = new NativePlayerCallbackEpoch();

        long first = epochs.next();
        assertTrue(epochs.isCurrent(first));

        long second = epochs.next();
        assertFalse(epochs.isCurrent(first));
        assertTrue(epochs.isCurrent(second));

        epochs.invalidate();
        assertFalse(epochs.isCurrent(second));
    }
}
