package top.neoshen.xingheyingguan.ad;

import java.util.ArrayList;
import java.util.List;

/**
 * Consent-aware, instance-scoped ordering gate for SDKs that share the global TTAdSdk process.
 *
 * <p>Pangle always establishes the one profile identity before Taku can initialize a mediated
 * adapter. Unknown consent never starts either SDK. Pending callbacks belong to this instance and
 * can be cancelled, so an Activity cannot leak work into a replacement Activity.</p>
 */
public final class ThirdPartySdkBootstrap {
    public static final int CONSENT_REQUIRED_CODE = -701;
    public static final int PANGLE_INIT_FAILED_CODE = -702;
    public static final int TAKU_INIT_FAILED_CODE = -703;
    public static final int BOOTSTRAP_CLOSED_CODE = -704;

    private static final String CONSENT_REQUIRED_MESSAGE =
            "Explicit privacy consent is required before third-party SDK initialization";

    public interface Callback {
        void onReady();

        void onBlocked(int code, String message);
    }

    public interface Completion {
        void onSuccess();

        void onFailure(int code, String message);
    }

    public interface Starter {
        void startPangle(Completion completion);

        void startTaku(Completion completion);
    }

    public interface Registration {
        void cancel();
    }

    private enum ConsentState {
        UNKNOWN,
        GRANTED,
        DENIED
    }

    private enum Target {
        CONTENT,
        REWARDED_AD
    }

    private final Starter starter;
    private final List<Pending> contentCallbacks = new ArrayList<>();
    private final List<Pending> adCallbacks = new ArrayList<>();
    private ConsentState consentState = ConsentState.UNKNOWN;
    private boolean pangleStarting;
    private boolean pangleReady;
    private boolean takuStarting;
    private boolean takuReady;
    private long pangleAttempt;
    private long takuAttempt;
    private boolean closed;

    public ThirdPartySdkBootstrap(Starter starter) {
        if (starter == null) {
            throw new IllegalArgumentException("SDK starter is required");
        }
        this.starter = starter;
    }

    public synchronized Registration whenContentReady(Callback callback) {
        return register(Target.CONTENT, callback);
    }

    public synchronized Registration whenRewardedAdReady(Callback callback) {
        return register(Target.REWARDED_AD, callback);
    }

    public synchronized void deliverConsent(boolean granted) {
        if (closed) {
            return;
        }
        consentState = granted ? ConsentState.GRANTED : ConsentState.DENIED;
        if (!granted) {
            blockAll(CONSENT_REQUIRED_CODE, CONSENT_REQUIRED_MESSAGE);
            return;
        }
        maybeStartPangle();
        maybeStartTaku();
    }

    public synchronized void close() {
        if (closed) {
            return;
        }
        closed = true;
        pangleAttempt += 1;
        takuAttempt += 1;
        pangleStarting = false;
        takuStarting = false;
        blockAll(BOOTSTRAP_CLOSED_CODE, "Third-party SDK bootstrap is closed");
    }

    private Registration register(Target target, Callback callback) {
        if (callback == null) {
            throw new IllegalArgumentException("SDK readiness callback is required");
        }
        if (closed) {
            callback.onBlocked(BOOTSTRAP_CLOSED_CODE, "Third-party SDK bootstrap is closed");
            return () -> { };
        }
        if (consentState == ConsentState.UNKNOWN) {
            callback.onBlocked(CONSENT_REQUIRED_CODE, CONSENT_REQUIRED_MESSAGE);
            return () -> { };
        }
        if (consentState == ConsentState.DENIED) {
            callback.onBlocked(CONSENT_REQUIRED_CODE, CONSENT_REQUIRED_MESSAGE);
            return () -> { };
        }
        if (target == Target.CONTENT && pangleReady) {
            callback.onReady();
            return () -> { };
        }
        if (target == Target.REWARDED_AD && takuReady) {
            callback.onReady();
            return () -> { };
        }
        Pending pending = new Pending(target, callback);
        callbacks(target).add(pending);
        maybeStartPangle();
        maybeStartTaku();
        return () -> cancel(pending);
    }

    private synchronized void cancel(Pending pending) {
        if (pending.terminal) {
            return;
        }
        pending.terminal = true;
        callbacks(pending.target).remove(pending);
    }

    private void maybeStartPangle() {
        if (consentState != ConsentState.GRANTED || pangleReady || pangleStarting
                || (contentCallbacks.isEmpty() && adCallbacks.isEmpty())) {
            return;
        }
        pangleStarting = true;
        long attempt = ++pangleAttempt;
        try {
            starter.startPangle(new Completion() {
                @Override
                public void onSuccess() {
                    completePangle(attempt);
                }

                @Override
                public void onFailure(int code, String message) {
                    failPangle(attempt);
                }
            });
        } catch (Throwable failure) {
            failPangle(attempt);
        }
    }

    private synchronized void completePangle(long attempt) {
        if (!pangleStarting || attempt != pangleAttempt) {
            return;
        }
        pangleStarting = false;
        pangleReady = true;
        ready(contentCallbacks);
        maybeStartTaku();
    }

    private synchronized void failPangle(long attempt) {
        if (!pangleStarting || attempt != pangleAttempt) {
            return;
        }
        pangleStarting = false;
        blockAll(PANGLE_INIT_FAILED_CODE, "Pangle initialization failed");
    }

    private void maybeStartTaku() {
        if (consentState != ConsentState.GRANTED || !pangleReady || takuReady || takuStarting
                || adCallbacks.isEmpty()) {
            return;
        }
        takuStarting = true;
        long attempt = ++takuAttempt;
        try {
            starter.startTaku(new Completion() {
                @Override
                public void onSuccess() {
                    completeTaku(attempt);
                }

                @Override
                public void onFailure(int code, String message) {
                    failTaku(attempt);
                }
            });
        } catch (Throwable failure) {
            failTaku(attempt);
        }
    }

    private synchronized void completeTaku(long attempt) {
        if (!takuStarting || attempt != takuAttempt) {
            return;
        }
        takuStarting = false;
        takuReady = true;
        ready(adCallbacks);
    }

    private synchronized void failTaku(long attempt) {
        if (!takuStarting || attempt != takuAttempt) {
            return;
        }
        takuStarting = false;
        blocked(adCallbacks, TAKU_INIT_FAILED_CODE, "Taku initialization failed");
    }

    private List<Pending> callbacks(Target target) {
        return target == Target.CONTENT ? contentCallbacks : adCallbacks;
    }

    private void blockAll(int code, String message) {
        blocked(contentCallbacks, code, message);
        blocked(adCallbacks, code, message);
    }

    private static void ready(List<Pending> callbacks) {
        List<Pending> ready = drain(callbacks);
        for (Pending pending : ready) {
            pending.callback.onReady();
        }
    }

    private static void blocked(List<Pending> callbacks, int code, String message) {
        List<Pending> blocked = drain(callbacks);
        for (Pending pending : blocked) {
            pending.callback.onBlocked(code, message);
        }
    }

    private static List<Pending> drain(List<Pending> callbacks) {
        List<Pending> drained = new ArrayList<>();
        for (Pending pending : callbacks) {
            if (!pending.terminal) {
                pending.terminal = true;
                drained.add(pending);
            }
        }
        callbacks.clear();
        return drained;
    }

    private static final class Pending {
        private final Target target;
        private final Callback callback;
        private boolean terminal;

        private Pending(Target target, Callback callback) {
            this.target = target;
            this.callback = callback;
        }
    }
}
