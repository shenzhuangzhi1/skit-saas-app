package top.neoshen.xingheyingguan;

import java.util.ArrayList;
import java.util.List;

/** Process-scoped, timeout-bounded single-flight for the asynchronous Taku SDK initializer. */
final class TakuSdkInitializationCoordinator {

    interface Callback {
        void onReady();

        void onFailure();
    }

    interface Completion {
        void onSuccess();

        void onFailure();
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

    private enum State {
        IDLE,
        STARTING,
        READY
    }

    private final List<Pending> callbacks = new ArrayList<>();
    private State state = State.IDLE;
    private long currentAttempt;
    private Cancellable timeout;

    Registration ensureStarted(Starter starter, Scheduler scheduler, long timeoutMillis,
                               Callback callback) {
        if (starter == null || scheduler == null || callback == null || timeoutMillis <= 0L) {
            throw new IllegalArgumentException("Taku initialization inputs are invalid");
        }

        Pending pending = new Pending(callback);
        boolean startAttempt = false;
        boolean reuseReady = false;
        long attempt = 0L;
        synchronized (this) {
            if (state == State.READY) {
                reuseReady = true;
            } else {
                callbacks.add(pending);
                if (state == State.IDLE) {
                    state = State.STARTING;
                    currentAttempt += 1L;
                    attempt = currentAttempt;
                    startAttempt = true;
                }
            }
        }

        if (reuseReady) {
            dispatchReady(scheduler, pending);
            return () -> pending.cancelled = true;
        }
        if (startAttempt) {
            final long ownedAttempt = attempt;
            try {
                Cancellable scheduled = scheduler.schedule(
                        () -> complete(ownedAttempt, false, scheduler), timeoutMillis);
                synchronized (this) {
                    if (state == State.STARTING && currentAttempt == ownedAttempt) {
                        timeout = scheduled;
                    } else {
                        scheduled.cancel();
                    }
                }
                scheduler.execute(() -> {
                    try {
                        starter.start(new Completion() {
                            @Override
                            public void onSuccess() {
                                complete(ownedAttempt, true, scheduler);
                            }

                            @Override
                            public void onFailure() {
                                complete(ownedAttempt, false, scheduler);
                            }
                        });
                    } catch (Throwable failure) {
                        complete(ownedAttempt, false, scheduler);
                    }
                });
            } catch (Throwable failure) {
                complete(ownedAttempt, false, scheduler);
            }
        }
        return () -> cancel(pending);
    }

    synchronized boolean isReady() {
        return state == State.READY;
    }

    private void complete(long attempt, boolean success, Scheduler scheduler) {
        List<Pending> drained;
        Cancellable timeoutToCancel;
        synchronized (this) {
            if (state != State.STARTING || currentAttempt != attempt) {
                return;
            }
            state = success ? State.READY : State.IDLE;
            timeoutToCancel = timeout;
            timeout = null;
            drained = new ArrayList<>(callbacks);
            callbacks.clear();
        }
        if (timeoutToCancel != null) {
            try {
                timeoutToCancel.cancel();
            } catch (Throwable ignoredCancellationFailure) {
                // Completion is already terminal; one broken timer cannot starve joined callers.
            }
        }
        for (Pending pending : drained) {
            if (success) {
                dispatchReady(scheduler, pending);
            } else {
                dispatchFailure(scheduler, pending);
            }
        }
    }

    private synchronized void cancel(Pending pending) {
        pending.cancelled = true;
        callbacks.remove(pending);
    }

    private static void dispatchReady(Scheduler scheduler, Pending pending) {
        dispatch(scheduler, pending, true);
    }

    private static void dispatchFailure(Scheduler scheduler, Pending pending) {
        dispatch(scheduler, pending, false);
    }

    private static void dispatch(Scheduler scheduler, Pending pending, boolean success) {
        try {
            scheduler.execute(() -> {
                if (pending.cancelled) {
                    return;
                }
                try {
                    if (success) {
                        pending.callback.onReady();
                    } else {
                        pending.callback.onFailure();
                    }
                } catch (Throwable ignoredCallbackFailure) {
                    // A caller owns its callback; it must not break process-wide initialization.
                }
            });
        } catch (Throwable ignoredDispatchFailure) {
            // Dispatch is best effort after the process state has reached a terminal result.
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
