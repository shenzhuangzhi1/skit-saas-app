package top.neoshen.xingheyingguan.update;

import org.junit.Test;

import java.io.IOException;
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

        RuntimeUpdateCommitter.commit(42L, new RuntimeUpdateCommitter.Transaction() {
            @Override
            public void activate() {
                operations.add("activate:42");
            }

            @Override
            public void rollback() {
                operations.add("rollback:42");
            }

            @Override
            public void complete() {
                operations.add("complete:42");
            }
        },
                releaseNo -> {
                    operations.add("persist:" + releaseNo);
                    return true;
                });

        assertEquals(Arrays.asList("activate:42", "persist:42", "complete:42"), operations);
    }

    @Test
    public void failedPersistenceRollsBackTheUncommittedActiveRelease() {
        AtomicLong activeRelease = new AtomicLong(41L);
        AtomicLong highestAcceptedRelease = new AtomicLong(41L);
        List<String> operations = new ArrayList<>();

        assertThrows(IOException.class, () -> RuntimeUpdateCommitter.commit(42L,
                new RuntimeUpdateCommitter.Transaction() {
                    @Override
                    public void activate() {
                        operations.add("activate:42");
                        activeRelease.set(42L);
                    }

                    @Override
                    public void rollback() {
                        operations.add("rollback:41");
                        activeRelease.set(41L);
                    }

                    @Override
                    public void complete() {
                        operations.add("complete:42");
                    }
                }, releaseNo -> {
                    operations.add("persist-failed:" + releaseNo);
                    return false;
                }));

        assertEquals(41L, activeRelease.get());
        assertEquals(41L, highestAcceptedRelease.get());
        assertEquals(Arrays.asList(
                "activate:42", "persist-failed:42", "rollback:41"), operations);
    }

    @Test
    public void processDeathLeavesRecoveryJournalForStartupInsteadOfRunningRollback()
            throws Exception {
        AtomicLong activeRelease = new AtomicLong(41L);
        List<String> operations = new ArrayList<>();

        assertThrows(SimulatedCrash.class, () -> RuntimeUpdateCommitter.commit(42L,
                new RuntimeUpdateCommitter.Transaction() {
                    @Override
                    public void activate() {
                        operations.add("activate:42");
                        activeRelease.set(42L);
                        throw new SimulatedCrash();
                    }

                    @Override
                    public void rollback() {
                        operations.add("rollback:41");
                        activeRelease.set(41L);
                    }

                    @Override
                    public void complete() {
                        operations.add("complete:42");
                    }
                }, releaseNo -> {
                    operations.add("persist:" + releaseNo);
                    return true;
                }));

        assertEquals(42L, activeRelease.get());
        assertEquals(Arrays.asList("activate:42"), operations);
    }

    @Test
    public void activationExceptionRollsBackBeforePersistence() {
        AtomicLong activeRelease = new AtomicLong(41L);

        assertThrows(IOException.class, () -> RuntimeUpdateCommitter.commit(42L,
                new RuntimeUpdateCommitter.Transaction() {
                    @Override
                    public void activate() throws IOException {
                        activeRelease.set(42L);
                        throw new IOException("partial activation");
                    }

                    @Override
                    public void rollback() {
                        activeRelease.set(41L);
                    }

                    @Override
                    public void complete() {
                    }
                }, releaseNo -> true));

        assertEquals(41L, activeRelease.get());
    }

    private static final class SimulatedCrash extends Error {
    }
}
