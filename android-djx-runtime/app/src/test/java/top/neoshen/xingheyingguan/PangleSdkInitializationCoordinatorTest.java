package top.neoshen.xingheyingguan;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PangleSdkInitializationCoordinatorTest {

    @Test
    public void joinsOneOwnedAttemptAndReusesOnlyWhileTheGlobalSdkIsReady() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback first = new RecordingCallback();
        RecordingCallback second = new RecordingCallback();

        coordinator.ensureStarted(false, starter, scheduler, 5_000L, first);
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, second);

        assertEquals(1, starter.starts);
        starter.success(0);
        assertEquals(1, first.successes);
        assertEquals(1, second.successes);

        RecordingCallback reused = new RecordingCallback();
        coordinator.ensureStarted(true, starter, scheduler, 5_000L, reused);
        assertEquals(1, starter.starts);
        assertEquals(1, reused.successes);

        RecordingCallback lost = new RecordingCallback();
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, lost);
        assertEquals(1, lost.failures);
        assertEquals(PangleSdkInitializationCoordinator.OWNED_STATE_LOST_CODE,
                lost.lastCode);
    }

    @Test
    public void timeoutFailsEveryWaiterAllowsRetryAndIgnoresLateCallbacks() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback first = new RecordingCallback();
        RecordingCallback second = new RecordingCallback();

        coordinator.ensureStarted(false, starter, scheduler, 5_000L, first);
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, second);
        scheduler.fireScheduled(0);

        assertEquals(1, first.failures);
        assertEquals(1, second.failures);
        assertEquals(PangleSdkInitializationCoordinator.TIMEOUT_CODE, first.lastCode);

        RecordingCallback retry = new RecordingCallback();
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, retry);
        assertEquals(2, starter.starts);
        starter.success(0);
        assertEquals(0, retry.successes);
        assertEquals(0, retry.failures);
        starter.success(1);
        assertEquals(1, retry.successes);

        scheduler.fireScheduled(1);
        assertEquals(1, retry.successes);
        assertEquals(0, retry.failures);
    }

    @Test
    public void cancellingOneActivityWaiterDoesNotCancelTheProcessAttempt() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback cancelled = new RecordingCallback();
        RecordingCallback active = new RecordingCallback();

        PangleSdkInitializationCoordinator.Registration registration =
                coordinator.ensureStarted(false, starter, scheduler, 5_000L, cancelled);
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, active);
        registration.cancel();
        starter.success(0);

        assertEquals(0, cancelled.successes);
        assertEquals(0, cancelled.failures);
        assertEquals(1, active.successes);
        assertEquals(1, starter.starts);
    }

    @Test
    public void staleTimeoutCannotDrainTheReplacementAttempt() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback timedOut = new RecordingCallback();

        coordinator.ensureStarted(false, starter, scheduler, 5_000L, timedOut);
        scheduler.fireScheduled(0);

        RecordingCallback retry = new RecordingCallback();
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, retry);
        scheduler.fireIgnoringCancellation(0);

        assertEquals(0, retry.successes);
        assertEquals(0, retry.failures);
        starter.success(1);
        assertEquals(1, retry.successes);
        assertEquals(0, retry.failures);
    }

    @Test
    public void cancelledOnlyWaiterStillTimesOutAndTheNextActivityCanRetry() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback abandoned = new RecordingCallback();

        PangleSdkInitializationCoordinator.Registration registration =
                coordinator.ensureStarted(false, starter, scheduler, 5_000L, abandoned);
        registration.cancel();
        scheduler.fireScheduled(0);

        RecordingCallback replacement = new RecordingCallback();
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, replacement);
        assertEquals(2, starter.starts);
        starter.success(1);
        assertEquals(1, replacement.successes);
        assertEquals(0, abandoned.successes);
        assertEquals(0, abandoned.failures);
    }

    @Test
    public void failedAttemptCanRetryAndOneBrokenWaiterCannotStarveTheOthers() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback active = new RecordingCallback();

        coordinator.ensureStarted(false, starter, scheduler, 5_000L,
                new PangleSdkInitializationCoordinator.Callback() {
                    @Override
                    public void onSuccess() {
                        throw new IllegalStateException("caller failed");
                    }

                    @Override
                    public void onFailure(int code, String message) {
                        throw new IllegalStateException("caller failed");
                    }
                });
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, active);
        starter.failure(0, 901);

        assertEquals(1, active.failures);
        assertEquals(901, active.lastCode);

        RecordingCallback retry = new RecordingCallback();
        coordinator.ensureStarted(false, starter, scheduler, 5_000L, retry);
        assertEquals(2, starter.starts);
        starter.success(1);
        assertEquals(1, retry.successes);
    }

    @Test
    public void rejectsAReadySingletonThatThisProcessDidNotOwn() {
        PangleSdkInitializationCoordinator coordinator =
                new PangleSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback rejected = new RecordingCallback();

        coordinator.ensureStarted(true, starter, scheduler, 5_000L, rejected);

        assertEquals(0, starter.starts);
        assertEquals(1, rejected.failures);
        assertEquals(PangleSdkInitializationCoordinator.UNOWNED_READY_CODE,
                rejected.lastCode);
    }

    private static final class RecordingCallback
            implements PangleSdkInitializationCoordinator.Callback {
        private int successes;
        private int failures;
        private int lastCode;

        @Override
        public void onSuccess() {
            successes += 1;
        }

        @Override
        public void onFailure(int code, String message) {
            failures += 1;
            lastCode = code;
        }
    }

    private static final class FakeStarter
            implements PangleSdkInitializationCoordinator.Starter {
        private final List<PangleSdkInitializationCoordinator.Completion> completions =
                new ArrayList<>();
        private int starts;

        @Override
        public void start(PangleSdkInitializationCoordinator.Completion completion) {
            starts += 1;
            completions.add(completion);
        }

        private void success(int index) {
            completions.get(index).onSuccess();
        }

        private void failure(int index, int code) {
            completions.get(index).onFailure(code, "failed");
        }
    }

    private static final class ManualScheduler
            implements PangleSdkInitializationCoordinator.Scheduler {
        private final List<Scheduled> scheduled = new ArrayList<>();

        @Override
        public PangleSdkInitializationCoordinator.Cancellable schedule(
                Runnable runnable, long delayMillis) {
            assertTrue(delayMillis > 0L);
            Scheduled item = new Scheduled(runnable);
            scheduled.add(item);
            return () -> item.cancelled = true;
        }

        @Override
        public void execute(Runnable runnable) {
            runnable.run();
        }

        private void fireScheduled(int index) {
            Scheduled item = scheduled.get(index);
            if (!item.cancelled) {
                item.runnable.run();
            }
        }

        private void fireIgnoringCancellation(int index) {
            scheduled.get(index).runnable.run();
        }
    }

    private static final class Scheduled {
        private final Runnable runnable;
        private boolean cancelled;

        private Scheduled(Runnable runnable) {
            this.runnable = runnable;
        }
    }
}
