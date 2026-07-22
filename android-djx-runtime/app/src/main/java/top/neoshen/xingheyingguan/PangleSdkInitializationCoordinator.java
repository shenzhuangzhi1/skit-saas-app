package top.neoshen.xingheyingguan;

import java.util.ArrayList;
import java.util.List;

/** Process-scoped, timeout-bounded ownership for the global Pangle SDK singleton. */
final class PangleSdkInitializationCoordinator {
    static final int UNOWNED_READY_CODE = -101;
    static final int OWNED_STATE_LOST_CODE = -102;
    static final int TIMEOUT_CODE = -103;

    interface Callback {
        void onSuccess();

        void onFailure(int code, String message);
    }

    interface Completion {
        void onSuccess();

        void onFailure(int code, String message);
    }

    interface Starter {
        void start(Completion completion);
    }

    interface Cancellable {
        void cancel();
    }

    interface Scheduler {
        Cancellable schedule(Runnable runnable, long delayMillis);

        void execute(Runnable runnable);
    }

    interface Registration {
        void cancel();
    }

    private static final String UNOWNED_READY_MESSAGE =
            "TTAdSdk has no owned bootstrap identity";
    private static final String OWNED_STATE_LOST_MESSAGE =
            "TTAdSdk owned state is unavailable";
    private static final String TIMEOUT_MESSAGE = "TTAdSdk initialization timed out";

    private final PangleBootstrapOwnership ownership = new PangleBootstrapOwnership();
    private final List<Pending> callbacks = new ArrayList<>();
    private long activeAttempt;
    private Cancellable timeout;

    Registration ensureStarted(boolean globalReady, Starter starter, Scheduler scheduler,
                               long timeoutMillis, Callback callback) {
        if (starter == null || scheduler == null || callback == null || timeoutMillis <= 0L) {
            throw new IllegalArgumentException("Pangle initialization inputs are invalid");
        }

        Pending pending = new Pending(callback);
        PangleBootstrapOwnership.Request request;
        synchronized (this) {
            request = ownership.request(globalReady);
            if (request.getDecision() == PangleBootstrapOwnership.Decision.START_OWNED
                    || request.getDecision()
                    == PangleBootstrapOwnership.Decision.JOIN_OWNED_START) {
                callbacks.add(pending);
                if (request.getDecision()
                        == PangleBootstrapOwnership.Decision.START_OWNED) {
                    activeAttempt = request.getAttempt();
                }
            }
        }

        if (request.getDecision() == PangleBootstrapOwnership.Decision.REUSE_OWNED) {
            dispatchSuccess(scheduler, pending);
            return () -> pending.cancelled = true;
        }
        if (request.getDecision()
                == PangleBootstrapOwnership.Decision.REJECT_UNOWNED_READY) {
            dispatchFailure(scheduler, pending, UNOWNED_READY_CODE, UNOWNED_READY_MESSAGE);
            return () -> pending.cancelled = true;
        }
        if (request.getDecision()
                == PangleBootstrapOwnership.Decision.REJECT_OWNED_STATE_LOST) {
            dispatchFailure(
                    scheduler, pending, OWNED_STATE_LOST_CODE, OWNED_STATE_LOST_MESSAGE);
            return () -> pending.cancelled = true;
        }
        if (request.getDecision()
                == PangleBootstrapOwnership.Decision.JOIN_OWNED_START) {
            return () -> cancel(pending);
        }

        long attempt = request.getAttempt();
        try {
            Cancellable scheduled = scheduler.schedule(
                    () -> completeTimeout(attempt, scheduler),
                    timeoutMillis);
            if (scheduled == null) {
                throw new IllegalStateException("Pangle timeout scheduling returned null");
            }
            synchronized (this) {
                if (activeAttempt == attempt) {
                    timeout = scheduled;
                } else {
                    scheduled.cancel();
                }
            }
            scheduler.execute(() -> startIfCurrent(starter, scheduler, attempt));
        } catch (Throwable failure) {
            completeFailure(attempt, scheduler, UNOWNED_READY_CODE,
                    "TTAdSdk initialization could not start");
        }
        return () -> cancel(pending);
    }

    private void startIfCurrent(Starter starter, Scheduler scheduler, long attempt) {
        synchronized (this) {
            if (activeAttempt != attempt) {
                return;
            }
        }
        try {
            starter.start(new Completion() {
                @Override
                public void onSuccess() {
                    completeSuccess(attempt, scheduler);
                }

                @Override
                public void onFailure(int code, String message) {
                    completeFailure(attempt, scheduler, code,
                            message == null ? "TTAdSdk initialization failed" : message);
                }
            });
        } catch (Throwable failure) {
            completeFailure(attempt, scheduler, UNOWNED_READY_CODE,
                    "TTAdSdk initialization failed");
        }
    }

    private void completeSuccess(long attempt, Scheduler scheduler) {
        List<Pending> drained;
        Cancellable timeoutToCancel;
        synchronized (this) {
            if (activeAttempt != attempt) {
                ownership.reconcileTimedOutSuccess(attempt);
                return;
            }
            if (!ownership.completeSuccess(attempt)) {
                return;
            }
            activeAttempt = 0L;
            timeoutToCancel = timeout;
            timeout = null;
            drained = drainCallbacksLocked();
        }
        cancelTimeout(timeoutToCancel);
        for (Pending pending : drained) {
            dispatchSuccess(scheduler, pending);
        }
    }

    private void completeTimeout(long attempt, Scheduler scheduler) {
        List<Pending> drained;
        Cancellable timeoutToCancel;
        synchronized (this) {
            if (activeAttempt != attempt || !ownership.completeTimeout(attempt)) {
                return;
            }
            activeAttempt = 0L;
            timeoutToCancel = timeout;
            timeout = null;
            drained = drainCallbacksLocked();
        }
        cancelTimeout(timeoutToCancel);
        for (Pending pending : drained) {
            dispatchFailure(scheduler, pending, TIMEOUT_CODE, TIMEOUT_MESSAGE);
        }
    }

    private void completeFailure(long attempt, Scheduler scheduler, int code, String message) {
        List<Pending> drained;
        Cancellable timeoutToCancel;
        synchronized (this) {
            if (activeAttempt != attempt) {
                ownership.reconcileTimedOutFailure(attempt);
                return;
            }
            if (!ownership.completeFailure(attempt)) {
                return;
            }
            activeAttempt = 0L;
            timeoutToCancel = timeout;
            timeout = null;
            drained = drainCallbacksLocked();
        }
        cancelTimeout(timeoutToCancel);
        for (Pending pending : drained) {
            dispatchFailure(scheduler, pending, code, message);
        }
    }

    private synchronized void cancel(Pending pending) {
        pending.cancelled = true;
        callbacks.remove(pending);
    }

    private List<Pending> drainCallbacksLocked() {
        List<Pending> drained = new ArrayList<>(callbacks);
        callbacks.clear();
        return drained;
    }

    private static void cancelTimeout(Cancellable timeout) {
        if (timeout == null) {
            return;
        }
        try {
            timeout.cancel();
        } catch (Throwable ignoredCancellationFailure) {
            // The process state is already terminal; a broken timer cannot change ownership.
        }
    }

    private static void dispatchSuccess(Scheduler scheduler, Pending pending) {
        dispatch(scheduler, pending, true, 0, "");
    }

    private static void dispatchFailure(Scheduler scheduler, Pending pending,
                                        int code, String message) {
        dispatch(scheduler, pending, false, code,
                message == null ? "TTAdSdk initialization failed" : message);
    }

    private static void dispatch(Scheduler scheduler, Pending pending, boolean success,
                                 int code, String message) {
        try {
            scheduler.execute(() -> {
                if (pending.cancelled) {
                    return;
                }
                try {
                    if (success) {
                        pending.callback.onSuccess();
                    } else {
                        pending.callback.onFailure(code, message);
                    }
                } catch (Throwable ignoredCallbackFailure) {
                    // A caller owns its callback; it must not starve joined callers.
                }
            });
        } catch (Throwable ignoredDispatchFailure) {
            // Dispatch is best effort after process state reached a terminal result.
        }
    }

    private static final class Pending {
        private final Callback callback;
        private volatile boolean cancelled;

        private Pending(Callback callback) {
            this.callback = callback;
        }
    }
}
