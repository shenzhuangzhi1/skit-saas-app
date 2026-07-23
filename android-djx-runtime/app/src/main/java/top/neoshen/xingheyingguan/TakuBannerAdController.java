package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.widget.FrameLayout;

import com.anythink.banner.api.ATBannerListener;
import com.anythink.banner.api.ATBannerView;
import com.anythink.core.api.ATAdConst;
import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.AdError;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Owns the single bottom-banner view attached to the Activity. */
final class TakuBannerAdController {
    private static final String TAG = "SkitTakuDisplay";

    interface ResultListener {
        void onResult(boolean success, String state, String failureReason);
    }

    interface ShowAuthorization {
        boolean canPresent();
    }

    interface LifecycleListener {
        void onClosed(String scene);
    }

    private final Activity activity;
    private final FrameLayout host;
    private final LifecycleListener lifecycleListener;
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private ActiveBanner active;
    private boolean destroyed;

    TakuBannerAdController(Activity activity, FrameLayout host,
                           LifecycleListener lifecycleListener) {
        if (activity == null || host == null || lifecycleListener == null) {
            throw new IllegalArgumentException(
                    "Banner Activity, host and lifecycle listener are required");
        }
        this.activity = activity;
        this.host = host;
        this.lifecycleListener = lifecycleListener;
    }

    void show(TakuDisplayAdRequest request, ResultListener listener,
              ShowAuthorization showAuthorization, long deadlineElapsedRealtime) {
        if (destroyed) {
            throw new IllegalStateException("Banner controller is destroyed");
        }
        if (request == null || listener == null || showAuthorization == null) {
            throw new IllegalArgumentException(
                    "Banner request, listener and authorization are required");
        }
        if (active != null && active.matches(request)) {
            active.respondOrQueue(listener);
            return;
        }

        releaseActive("REPLACED");
        ATBannerView view = new ATBannerView(activity);
        int bannerWidth = activity.getResources().getDisplayMetrics().widthPixels;
        int bannerHeight = Math.round(bannerWidth / (320f / 50f));
        ActiveBanner banner = new ActiveBanner(
                request, view, showAuthorization, deadlineElapsedRealtime);
        banner.respondOrQueue(listener);
        active = banner;
        view.setPlacementId(request.getPlacementId());
        view.setScenario(request.getScene());
        Map<String, Object> localExtra = new HashMap<>();
        localExtra.put(ATAdConst.KEY.AD_WIDTH, bannerWidth);
        localExtra.put(ATAdConst.KEY.AD_HEIGHT, bannerHeight);
        view.setLocalExtra(localExtra);
        view.setBannerAdListener(new ATBannerListener() {
            @Override
            public void onBannerLoaded() {
                if (!isActive(banner)) {
                    return;
                }
                if (SystemClock.elapsedRealtime() >= banner.deadlineElapsedRealtime) {
                    fail(banner, "SDK_FAILURE");
                    return;
                }
                if (!canPresent(banner)) {
                    fail(banner, "CANCELLED");
                    return;
                }
                host.setVisibility(View.VISIBLE);
            }

            @Override
            public void onBannerFailed(AdError error) {
                logAdError("load", error);
                fail(banner, failureReason(error));
            }

            @Override
            public void onBannerClicked(ATAdInfo adInfo) {
                // Non-terminal provider event.
            }

            @Override
            public void onBannerShow(ATAdInfo adInfo) {
                if (!isActive(banner)) {
                    return;
                }
                if (SystemClock.elapsedRealtime() >= banner.deadlineElapsedRealtime) {
                    fail(banner, "SDK_FAILURE");
                    return;
                }
                if (!canPresent(banner)) {
                    fail(banner, "CANCELLED");
                    return;
                }
                banner.shown = true;
                cancelTimeout(banner);
                host.setVisibility(View.VISIBLE);
                banner.respondAll(true, "SHOWING", null);
            }

            @Override
            public void onBannerClose(ATAdInfo adInfo) {
                if (isActive(banner)) {
                    String scene = banner.request.getScene();
                    releaseActive("CLOSED");
                    lifecycleListener.onClosed(scene);
                }
            }

            @Override
            public void onBannerAutoRefreshed(ATAdInfo adInfo) {
                // The existing view remains active.
            }

            @Override
            public void onBannerAutoRefreshFail(AdError error) {
                logAdError("refresh", error);
            }
        });

        host.removeAllViews();
        host.addView(view, new FrameLayout.LayoutParams(
                bannerWidth,
                bannerHeight));
        host.setVisibility(View.INVISIBLE);
        if (!scheduleTimeout(banner, deadlineElapsedRealtime)) {
            return;
        }
        try {
            view.loadAd();
        } catch (Throwable error) {
            logInternalFailure("load-start", error);
            fail(banner, "SDK_FAILURE");
        }
    }

    void hide(String scene, ResultListener listener) {
        if (listener == null) {
            throw new IllegalArgumentException("Banner hide listener is required");
        }
        ActiveBanner banner = active;
        if (banner == null) {
            listener.onResult(true, "HIDDEN", null);
            return;
        }
        if (!banner.request.getScene().equals(scene)) {
            listener.onResult(false, "ERROR", "SCENE_MISMATCH");
            return;
        }
        releaseActive("CANCELLED");
        listener.onResult(true, "HIDDEN", null);
    }

    void destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;
        releaseActive("CANCELLED");
    }

    private boolean isActive(ActiveBanner banner) {
        return banner != null && !destroyed && active == banner;
    }

    private boolean canPresent(ActiveBanner banner) {
        try {
            return !activity.isFinishing() && !activity.isDestroyed()
                    && banner.showAuthorization.canPresent();
        } catch (Throwable error) {
            logInternalFailure("authorization", error);
            return false;
        }
    }

    private void fail(ActiveBanner banner, String reason) {
        if (!isActive(banner)) {
            return;
        }
        banner.respondAll(false, "ERROR", reason);
        release(banner, null);
    }

    private void releaseActive(String pendingFailureReason) {
        ActiveBanner banner = active;
        if (banner != null) {
            banner.respondAll(false, "ERROR", pendingFailureReason);
            release(banner, pendingFailureReason);
        } else {
            host.removeAllViews();
            host.setVisibility(View.GONE);
        }
    }

    private void release(ActiveBanner banner, String ignoredReason) {
        if (active == banner) {
            active = null;
        }
        cancelTimeout(banner);
        host.removeAllViews();
        host.setVisibility(View.GONE);
        try {
            banner.view.destroy();
        } catch (Throwable error) {
            logInternalFailure("destroy", error);
        }
    }

    private static String failureReason(AdError error) {
        String code = error == null ? null : error.getCode();
        if ("4001".equals(code) || "4009".equals(code)) {
            return "NO_FILL";
        }
        return "SDK_FAILURE";
    }

    private boolean scheduleTimeout(ActiveBanner banner, long deadlineElapsedRealtime) {
        banner.timeoutRunnable = () -> fail(banner, "SDK_FAILURE");
        long delayMillis = deadlineElapsedRealtime - SystemClock.elapsedRealtime();
        if (delayMillis <= 0L
                || !timeoutHandler.postDelayed(banner.timeoutRunnable, delayMillis)) {
            banner.timeoutRunnable.run();
        }
        return isActive(banner);
    }

    private void cancelTimeout(ActiveBanner banner) {
        Runnable timeout = banner == null ? null : banner.timeoutRunnable;
        if (timeout != null) {
            timeoutHandler.removeCallbacks(timeout);
            banner.timeoutRunnable = null;
        }
    }

    private static void logAdError(String stage, AdError error) {
        String code = error == null ? null : error.getCode();
        Log.w(TAG, "Taku banner " + stage + " failed: code=" + safeCode(code));
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
        Log.w(TAG, "Taku banner " + stage + " failed: type=" + type);
    }

    private static final class ActiveBanner {
        private final TakuDisplayAdRequest request;
        private final ATBannerView view;
        private final ShowAuthorization showAuthorization;
        private final long deadlineElapsedRealtime;
        private final List<ResultListener> pendingListeners = new ArrayList<>();
        private boolean shown;
        private Runnable timeoutRunnable;

        private ActiveBanner(TakuDisplayAdRequest request, ATBannerView view,
                             ShowAuthorization showAuthorization,
                             long deadlineElapsedRealtime) {
            this.request = request;
            this.view = view;
            this.showAuthorization = showAuthorization;
            this.deadlineElapsedRealtime = deadlineElapsedRealtime;
        }

        private boolean matches(TakuDisplayAdRequest candidate) {
            return request.matches(candidate);
        }

        private void respondOrQueue(ResultListener listener) {
            if (shown) {
                listener.onResult(true, "SHOWING", null);
            } else {
                pendingListeners.add(listener);
            }
        }

        private void respondAll(boolean success, String state, String failureReason) {
            List<ResultListener> listeners = new ArrayList<>(pendingListeners);
            pendingListeners.clear();
            for (ResultListener listener : listeners) {
                listener.onResult(success, state, failureReason);
            }
        }
    }
}
