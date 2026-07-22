package top.neoshen.xingheyingguan;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TakuSdkInitializationCoordinatorTest {

    @Test
    public void joinsOneProcessAttemptAndReusesOnlyAConfirmedReadyState() {
        TakuSdkInitializationCoordinator coordinator =
                new TakuSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback first = new RecordingCallback();
        RecordingCallback second = new RecordingCallback();

        coordinator.ensureStarted(starter, scheduler, 5_000L, first);
        coordinator.ensureStarted(starter, scheduler, 5_000L, second);

        assertEquals(1, starter.starts);
        assertFalse(coordinator.isReady());
        starter.success(0);
        assertTrue(coordinator.isReady());
        assertEquals(1, first.ready);
        assertEquals(1, second.ready);

        RecordingCallback reused = new RecordingCallback();
        coordinator.ensureStarted(starter, scheduler, 5_000L, reused);
        assertEquals(1, starter.starts);
        assertEquals(1, reused.ready);
    }

    @Test
    public void timeoutFailsClosedAllowsRetryAndRejectsTheStaleSuccess() {
        TakuSdkInitializationCoordinator coordinator =
                new TakuSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback first = new RecordingCallback();

        coordinator.ensureStarted(starter, scheduler, 5_000L, first);
        scheduler.fireScheduled(0);
        assertEquals(1, first.failed);
        assertFalse(coordinator.isReady());

        RecordingCallback retry = new RecordingCallback();
        coordinator.ensureStarted(starter, scheduler, 5_000L, retry);
        assertEquals(2, starter.starts);
        starter.success(0);
        assertFalse(coordinator.isReady());
        assertEquals(0, retry.ready);
        starter.success(1);
        assertTrue(coordinator.isReady());
        assertEquals(1, retry.ready);
    }

    @Test
    public void cancellingOneCallerDoesNotCancelTheSharedProcessAttempt() {
        TakuSdkInitializationCoordinator coordinator =
                new TakuSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback cancelled = new RecordingCallback();
        RecordingCallback active = new RecordingCallback();

        TakuSdkInitializationCoordinator.Registration registration =
                coordinator.ensureStarted(starter, scheduler, 5_000L, cancelled);
        coordinator.ensureStarted(starter, scheduler, 5_000L, active);
        registration.cancel();
        starter.success(0);

        assertTrue(coordinator.isReady());
        assertEquals(0, cancelled.ready);
        assertEquals(0, cancelled.failed);
        assertEquals(1, active.ready);
    }

    @Test
    public void callbackFailureFailsEveryWaiterAndTheNextCallerCanRetry() {
        TakuSdkInitializationCoordinator coordinator =
                new TakuSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback first = new RecordingCallback();
        RecordingCallback second = new RecordingCallback();

        coordinator.ensureStarted(starter, scheduler, 5_000L, first);
        coordinator.ensureStarted(starter, scheduler, 5_000L, second);
        starter.failure(0);

        assertFalse(coordinator.isReady());
        assertEquals(1, first.failed);
        assertEquals(1, second.failed);

        RecordingCallback retry = new RecordingCallback();
        coordinator.ensureStarted(starter, scheduler, 5_000L, retry);
        assertEquals(2, starter.starts);
        starter.success(1);
        assertTrue(coordinator.isReady());
        assertEquals(1, retry.ready);
    }

    @Test
    public void oneThrowingWaiterCannotStarveOtherJoinedCallers() {
        TakuSdkInitializationCoordinator coordinator =
                new TakuSdkInitializationCoordinator();
        FakeStarter starter = new FakeStarter();
        ManualScheduler scheduler = new ManualScheduler();
        RecordingCallback active = new RecordingCallback();

        coordinator.ensureStarted(starter, scheduler, 5_000L,
                new TakuSdkInitializationCoordinator.Callback() {
                    @Override
                    public void onReady() {
                        throw new IllegalStateException("caller failed");
                    }

                    @Override
                    public void onFailure() {
                        throw new IllegalStateException("caller failed");
                    }
                });
        coordinator.ensureStarted(starter, scheduler, 5_000L, active);

        starter.success(0);

        assertTrue(coordinator.isReady());
        assertEquals(1, active.ready);
    }

    private static final class RecordingCallback
            implements TakuSdkInitializationCoordinator.Callback {
        private int ready;
        private int failed;

        @Override
        public void onReady() {
            ready += 1;
        }

        @Override
        public void onFailure() {
            failed += 1;
        }
    }

    private static final class FakeStarter
            implements TakuSdkInitializationCoordinator.Starter {
        private final List<TakuSdkInitializationCoordinator.Completion> completions =
                new ArrayList<>();
        private int starts;

        @Override
        public void start(TakuSdkInitializationCoordinator.Completion completion) {
            starts += 1;
            completions.add(completion);
        }

        private void success(int index) {
            completions.get(index).onSuccess();
        }

        private void failure(int index) {
            completions.get(index).onFailure();
        }
    }

    private static final class ManualScheduler
            implements TakuSdkInitializationCoordinator.Scheduler {
        private final List<Scheduled> scheduled = new ArrayList<>();

        @Override
        public TakuSdkInitializationCoordinator.Cancellable schedule(
                Runnable runnable, long delayMillis) {
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
    }

    private static final class Scheduled {
        private final Runnable runnable;
        private boolean cancelled;

        private Scheduled(Runnable runnable) {
            this.runnable = runnable;
        }
    }
}
