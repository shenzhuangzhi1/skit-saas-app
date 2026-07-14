package top.neoshen.xingheyingguan.update;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class RuntimeUpdateCommitterTest {

    @Test
    public void durablyActivatesBeforeAdvancingAntiRollbackState() throws Exception {
        List<String> operations = new ArrayList<>();

        RuntimeUpdateCommitter.activateThenPersist(42L,
                () -> operations.add("activate:42"),
                releaseNo -> {
                    operations.add("persist:" + releaseNo);
                    return true;
                });

        assertEquals(Arrays.asList("activate:42", "persist:42"), operations);
    }

    @Test
    public void crashAfterActivationDoesNotPoisonRetryOfTheSameRelease() throws Exception {
        AtomicLong activeRelease = new AtomicLong(41L);
        AtomicLong highestAcceptedRelease = new AtomicLong(41L);

        assertThrows(SimulatedCrash.class, () -> RuntimeUpdateCommitter.activateThenPersist(42L,
                () -> {
                    activeRelease.set(42L);
                    throw new SimulatedCrash();
                }, releaseNo -> {
                    highestAcceptedRelease.set(releaseNo);
                    return true;
                }));

        assertEquals(42L, activeRelease.get());
        assertEquals(41L, highestAcceptedRelease.get());

        RuntimeUpdateCommitter.activateThenPersist(42L,
                () -> activeRelease.set(42L),
                releaseNo -> {
                    highestAcceptedRelease.set(releaseNo);
                    return true;
                });

        assertEquals(42L, activeRelease.get());
        assertEquals(42L, highestAcceptedRelease.get());
    }

    private static final class SimulatedCrash extends Error {
    }
}
