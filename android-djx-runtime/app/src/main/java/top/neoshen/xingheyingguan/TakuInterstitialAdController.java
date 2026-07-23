package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.AdError;
import com.anythink.interstitial.api.ATInterstitial;
import com.anythink.interstitial.api.ATInterstitialListener;

import java.util.concurrent.atomic.AtomicBoolean;

/** Owns one Taku interstitial request and emits exactly one terminal callback. */
final class TakuInterstitialAdController {
    private static final String TAG = "SkitTakuDisplay";
    private static final long INTERSTITIAL_TERMINAL_TIMEOUT_MILLIS = 120_000L;

    interface ResultListener {
        void onResult(boolean success, String state, String failureReason);
    }

    interface ShowAuthorization {
        boolean canPresent();
    }

    private final Activity activity;
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private ActiveSession active;
    private boolean destroyed;

    TakuInterstitialAdController(Activity activity) {
        this.activity = activity;
    }

    void show(String requestId, TakuDisplayAdRequest request, ResultListener listener,
              ShowAuthorization showAuthorization, long deadlineElapsedRealtime) {
        if (destroyed) {
            throw new IllegalStateException("Interstitial controller is destroyed");
        }
        if (requestId == null || requestId.length() == 0
                || request == null || listener == null || showAuthorization == null) {
            throw new IllegalArgumentException(
                    "Interstitial ID, request, listener and authorization are required");
        }
        if (active != null) {
            listener.onResult(false, "ERROR", "BUSY");
            return;
        }

        ATInterstitial ad = new ATInterstitial(activity, request.getPlacementId());
        ActiveSession session = new ActiveSession(
                requestId, request, ad, listener, showAuthorization,
                deadlineElapsedRealtime);
        active = session;
        ad.setAdListener(new ATInterstitialListener() {
            @Override
            public void onInterstitialAdLoaded() {
                if (!isActive(session)) {
                    return;
                }
                if (SystemClock.elapsedRealtime() >= session.deadlineElapsedRealtime) {
                    complete(session, false, "ERROR", "SDK_FAILURE");
                    return;
                }
                cancelLoadTimeout(session);
                try {
                    if (!canPresent(session)) {
                        complete(session, false, "ERROR", "CANCELLED");
                        return;
                    }
                    if (!scheduleTerminalTimeout(session)) {
                        return;
                    }
                    ad.show(activity);
                } catch (Throwable error) {
                    logInternalFailure("show", error);
                    completeFailure(session, null);
                }
            }

            @Override
            public void onInterstitialAdLoadFail(AdError error) {
                logAdError("load", error);
                completeFailure(session, error);
            }

            @Override
            public void onInterstitialAdClicked(ATAdInfo adInfo) {
                // Non-terminal provider event.
            }

            @Override
            public void onInterstitialAdShow(ATAdInfo adInfo) {
                // A single terminal result is intentionally deferred until close/failure.
            }

            @Override
            public void onInterstitialAdClose(ATAdInfo adInfo) {
                complete(session, true, "CLOSED", null);
            }

            @Override
            public void onInterstitialAdVideoStart(ATAdInfo adInfo) {
                // Non-terminal provider event.
            }

            @Override
            public void onInterstitialAdVideoEnd(ATAdInfo adInfo) {
                // Non-terminal provider event.
            }

            @Override
            public void onInterstitialAdVideoError(AdError error) {
                logAdError("video", error);
                completeFailure(session, error);
            }
        });
        if (!scheduleLoadTimeout(session, deadlineElapsedRealtime)) {
            return;
        }
        try {
            ad.load(activity);
        } catch (Throwable error) {
            logInternalFailure("load-start", error);
            completeFailure(session, null);
        }
    }

    boolean cancel(String requestId) {
        ActiveSession session = active;
        if (session == null || requestId == null
                || !session.requestId.equals(requestId)) {
            return false;
        }
        complete(session, false, "ERROR", "CANCELLED");
        return true;
    }

    void destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;
        ActiveSession session = active;
        active = null;
        if (session != null && session.terminal.compareAndSet(false, true)) {
            cancelLoadTimeout(session);
            cancelTerminalTimeout(session);
            destroyAd(session.ad);
        }
    }

    private boolean isActive(ActiveSession session) {
        return session != null && !destroyed && active == session
                && !session.terminal.get();
    }

    private boolean canPresent(ActiveSession session) {
        return !activity.isFinishing() && !activity.isDestroyed()
                && activity.hasWindowFocus() && session.showAuthorization.canPresent();
    }

    private void completeFailure(ActiveSession session, AdError error) {
        complete(session, false, "ERROR", failureReason(error));
    }

    private void complete(ActiveSession session, boolean success, String state,
                          String failureReason) {
        if (session == null || !session.terminal.compareAndSet(false, true)) {
            return;
        }
        if (active == session) {
            active = null;
        }
        cancelLoadTimeout(session);
        cancelTerminalTimeout(session);
        destroyAd(session.ad);
        try {
            session.listener.onResult(success, state, failureReason);
        } catch (Throwable error) {
            logInternalFailure("terminal-callback", error);
        }
    }

    private static String failureReason(AdError error) {
        String code = error == null ? null : error.getCode();
        if ("4001".equals(code) || "4009".equals(code)) {
            return "NO_FILL";
        }
        return "SDK_FAILURE";
    }

    private boolean scheduleLoadTimeout(
            ActiveSession session, long deadlineElapsedRealtime) {
        session.loadTimeoutRunnable =
                () -> complete(session, false, "ERROR", "SDK_FAILURE");
        long delayMillis = deadlineElapsedRealtime - SystemClock.elapsedRealtime();
        if (delayMillis <= 0L
                || !timeoutHandler.postDelayed(session.loadTimeoutRunnable, delayMillis)) {
            session.loadTimeoutRunnable.run();
        }
        return isActive(session);
    }

    private boolean scheduleTerminalTimeout(ActiveSession session) {
        session.terminalTimeoutRunnable =
                () -> complete(session, false, "ERROR", "SDK_FAILURE");
        if (!timeoutHandler.postDelayed(
                session.terminalTimeoutRunnable,
                INTERSTITIAL_TERMINAL_TIMEOUT_MILLIS)) {
            session.terminalTimeoutRunnable.run();
        }
        return isActive(session);
    }

    private void cancelLoadTimeout(ActiveSession session) {
        Runnable timeout = session == null ? null : session.loadTimeoutRunnable;
        if (timeout != null) {
            timeoutHandler.removeCallbacks(timeout);
            session.loadTimeoutRunnable = null;
        }
    }

    private void cancelTerminalTimeout(ActiveSession session) {
        Runnable timeout = session == null ? null : session.terminalTimeoutRunnable;
        if (timeout != null) {
            timeoutHandler.removeCallbacks(timeout);
            session.terminalTimeoutRunnable = null;
        }
    }

    private static void destroyAd(ATInterstitial ad) {
        try {
            ad.destroyAd();
        } catch (Throwable error) {
            logInternalFailure("destroy", error);
        }
    }

    private static void logAdError(String stage, AdError error) {
        String code = error == null ? null : error.getCode();
        Log.w(TAG, "Taku interstitial " + stage + " failed: code=" + safeCode(code));
    }

    private static String safeCode(String code) {
        if (code == null || code.length() == 0) {
            return "<none>";
        }
        return code.matches("[A-Za-z0-9._-]{1,64}") ? code : "<invalid>";
    }

    private static void logInternalFailure(String stage, Throwable error) {
        String type = error == null ? "<none>" : error.getClass().getSimpleName();
        if (!type.matches("[A-Za-z0-9_$]{1,64}")) {
            type = "<invalid>";
        }
        Log.w(TAG, "Taku interstitial " + stage + " failed: type=" + type);
    }

    private static final class ActiveSession {
        private final String requestId;
        private final TakuDisplayAdRequest request;
        private final ATInterstitial ad;
        private final ResultListener listener;
        private final ShowAuthorization showAuthorization;
        private final long deadlineElapsedRealtime;
        private final AtomicBoolean terminal = new AtomicBoolean();
        private Runnable loadTimeoutRunnable;
        private Runnable terminalTimeoutRunnable;

        private ActiveSession(String requestId, TakuDisplayAdRequest request,
                              ATInterstitial ad,
                              ResultListener listener,
                              ShowAuthorization showAuthorization,
                              long deadlineElapsedRealtime) {
            this.requestId = requestId;
            this.request = request;
            this.ad = ad;
            this.listener = listener;
            this.showAuthorization = showAuthorization;
            this.deadlineElapsedRealtime = deadlineElapsedRealtime;
        }
    }
}
