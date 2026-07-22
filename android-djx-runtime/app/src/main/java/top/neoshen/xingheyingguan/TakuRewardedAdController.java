package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.anythink.core.api.ATAdConst;
import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.ATDebuggerConfig;
import com.anythink.core.api.ATNetworkConfig;
import com.anythink.core.api.ATSDK;
import com.anythink.core.api.ATSDKInitListener;
import com.anythink.core.api.ATShowConfig;
import com.anythink.core.api.AdError;
import com.anythink.rewardvideo.api.ATRewardVideoAd;
import com.anythink.rewardvideo.api.ATRewardVideoListener;

import java.util.HashMap;
import java.util.Map;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.SafeEvidenceReference;
import top.neoshen.xingheyingguan.ad.TakuFailureReason;
import top.neoshen.xingheyingguan.ad.TakuPresentationLease;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;

/** Owns one Taku ad object at a time and never reuses it across server sessions. */
final class TakuRewardedAdController {
    static final String APP_ID = BuildConfig.TAKU_APP_ID;
    static final String APP_KEY = BuildConfig.TAKU_APP_KEY;

    private static final String TAG = "SkitTakuAd";
    private static final long INITIALIZATION_TIMEOUT_MILLIS = 15_000L;
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static final TakuSdkInitializationCoordinator INITIALIZATION =
            new TakuSdkInitializationCoordinator();
    private static final TakuSdkInitializationCoordinator.Scheduler MAIN_SCHEDULER =
            new TakuSdkInitializationCoordinator.Scheduler() {
                @Override
                public TakuSdkInitializationCoordinator.Cancellable schedule(
                        Runnable runnable, long delayMillis) {
                    if (!MAIN_HANDLER.postDelayed(runnable, delayMillis)) {
                        throw new IllegalStateException("Taku timeout scheduling failed");
                    }
                    return () -> MAIN_HANDLER.removeCallbacks(runnable);
                }

                @Override
                public void execute(Runnable runnable) {
                    if (Looper.myLooper() == Looper.getMainLooper()) {
                        runnable.run();
                    } else if (!MAIN_HANDLER.post(runnable)) {
                        throw new IllegalStateException("Taku main-thread dispatch failed");
                    }
                }
            };

    interface EventListener {
        void onTelemetry(TakuTelemetry telemetry);
    }

    interface ShowAuthorization {
        boolean canPresent();
    }

    interface InitializationCallback {
        void onReady();

        void onFailure();
    }

    private final Activity activity;
    private ATRewardVideoAd activeAd;
    private ActiveSession activeSession;
    private boolean destroyed;

    TakuRewardedAdController(Activity activity) {
        this.activity = activity;
    }

    static TakuSdkInitializationCoordinator.Registration initialize(
            Context context, InitializationCallback callback) {
        if (context == null || callback == null) {
            throw new IllegalArgumentException("Taku initialization context and callback are required");
        }
        Context applicationContext = context.getApplicationContext();
        return INITIALIZATION.ensureStarted(completion -> {
            boolean debuggerEnabled = BuildConfig.DEBUG
                    && BuildConfig.TAKU_DEBUG_NETWORK_FIRM_ID > 0
                    && !BuildConfig.TAKU_DEBUG_DEVICE_ID.isEmpty();
            if (debuggerEnabled) {
                ATSDK.setDebuggerConfig(
                        applicationContext,
                        BuildConfig.TAKU_DEBUG_DEVICE_ID,
                        new ATDebuggerConfig.Builder(
                                BuildConfig.TAKU_DEBUG_NETWORK_FIRM_ID).build());
            }
            ATSDK.setNetworkLogDebug(BuildConfig.DEBUG);
            ATSDK.init(applicationContext, APP_ID, APP_KEY,
                    new ATNetworkConfig.Builder().build(), new ATSDKInitListener() {
                        @Override
                        public void onSuccess() {
                            try {
                                MAIN_SCHEDULER.execute(() -> {
                                    try {
                                        ATSDK.start();
                                        Log.i(TAG, "Taku SDK initialized: "
                                                + ATSDK.getSDKVersionName());
                                        completion.onSuccess();
                                    } catch (Throwable error) {
                                        logInternalFailure("sdk-start", error);
                                        completion.onFailure();
                                    }
                                });
                            } catch (Throwable error) {
                                logInternalFailure("sdk-start-dispatch", error);
                                completion.onFailure();
                            }
                        }

                        @Override
                        public void onFail(String ignoredProviderMessage) {
                            Log.w(TAG, "Taku SDK initialization callback reported failure");
                            completion.onFailure();
                        }
                    });
        }, MAIN_SCHEDULER, INITIALIZATION_TIMEOUT_MILLIS,
                new TakuSdkInitializationCoordinator.Callback() {
                    @Override
                    public void onReady() {
                        callback.onReady();
                    }

                    @Override
                    public void onFailure() {
                        callback.onFailure();
                    }
                });
    }

    void start(AdSessionProtocol protocol, EventListener listener) {
        start(protocol, listener, () -> true);
    }

    void start(AdSessionProtocol protocol, EventListener listener,
               ShowAuthorization showAuthorization) {
        if (destroyed) {
            throw new IllegalStateException("Taku controller is destroyed");
        }
        if (protocol == null || listener == null || showAuthorization == null) {
            throw new IllegalArgumentException(
                    "Protocol, listener and show authorization are required");
        }
        if (activeSession != null || activeAd != null) {
            throw new IllegalStateException("Another Taku session is active");
        }

        if (!INITIALIZATION.isReady()) {
            throw new IllegalStateException("Taku SDK must pass the consent-aware bootstrap first");
        }
        String sdkRequestId = "native-" + protocol.getSessionId();
        ActiveSession session = new ActiveSession(
                protocol, listener, showAuthorization,
                new TakuSessionStateMachine(protocol, sdkRequestId));
        session.machine.initializing();
        ATRewardVideoAd ad = new ATRewardVideoAd(activity, protocol.getPlacementId());
        activeSession = session;
        activeAd = ad;
        ad.setAdListener(listenerFor(session, ad));

        Map<String, Object> localExtra = new HashMap<>();
        localExtra.put(ATAdConst.KEY.USER_ID, protocol.getUserId());
        localExtra.put(ATAdConst.KEY.USER_CUSTOM_DATA, protocol.getCustomData());
        ad.setLocalExtra(localExtra);
        emit(session, session.machine.loading());
        try {
            ad.load(activity);
        } catch (Throwable error) {
            logInternalFailure("load-start", error);
            fail(session, ad);
        }
    }

    void destroy() {
        if (destroyed) {
            return;
        }
        ActiveSession session = activeSession;
        ATRewardVideoAd ad = activeAd;
        if (isActive(session, ad)) {
            fail(session, ad);
        }
        destroyed = true;
        releaseActive();
    }

    void cancelActiveSession() {
        releaseActive();
    }

    boolean cancelPendingSession() {
        ActiveSession session = activeSession;
        ATRewardVideoAd ad = activeAd;
        if (!isActive(session, ad) || !session.presentationLease.cancelBeforeShow()) {
            return false;
        }
        fail(session, ad);
        return true;
    }

    private ATRewardVideoListener listenerFor(ActiveSession session, ATRewardVideoAd ad) {
        return new ATRewardVideoListener() {
            @Override
            public void onRewardedVideoAdLoaded() {
                if (!isActive(session, ad)) {
                    return;
                }
                try {
                    emit(session, session.machine.loaded());
                    if (!canPresent(session)
                            || !session.presentationLease.requestShow()) {
                        cancelPendingSession();
                        return;
                    }
                    AdSessionProtocol protocol = session.protocol;
                    ATShowConfig showConfig = new ATShowConfig.Builder()
                            .showCustomExt(protocol.getSessionId())
                            .build();
                    ad.show(activity, showConfig);
                } catch (Throwable error) {
                    logInternalFailure("show-start", error);
                    fail(session, ad);
                }
            }

            @Override
            public void onRewardedVideoAdFailed(AdError error) {
                logAdError("load", error);
                fail(session, ad, TakuFailureReason.fromSdkCode(
                        error == null ? null : error.getCode()));
            }

            @Override
            public void onRewardedVideoAdPlayStart(ATAdInfo adInfo) {
                if (!isActive(session, ad)) {
                    return;
                }
                try {
                    emit(session, session.machine.showing(
                            showId(adInfo), networkFirmId(adInfo), adsourceId(adInfo)));
                } catch (Throwable invalidCallback) {
                    logInternalFailure("play-start-identity", invalidCallback);
                    fail(session, ad);
                }
            }

            @Override
            public void onRewardedVideoAdPlayEnd(ATAdInfo adInfo) {
                validateRelatedCallback(session, ad, adInfo, "play-end");
            }

            @Override
            public void onRewardedVideoAdPlayFailed(AdError error, ATAdInfo adInfo) {
                logAdError("play", error);
                fail(session, ad, TakuFailureReason.fromSdkCode(
                        error == null ? null : error.getCode()));
            }

            @Override
            public void onRewardedVideoAdClosed(ATAdInfo adInfo) {
                if (!isActive(session, ad)) {
                    return;
                }
                try {
                    TakuTelemetry telemetry = session.machine.closed(
                            showId(adInfo), networkFirmId(adInfo), adsourceId(adInfo));
                    emit(session, telemetry);
                } catch (Throwable invalidCallback) {
                    logInternalFailure("close-identity", invalidCallback);
                    fail(session, ad);
                    return;
                }
                release(session, ad);
            }

            @Override
            public void onRewardedVideoAdPlayClicked(ATAdInfo adInfo) {
                validateRelatedCallback(session, ad, adInfo, "click");
            }

            @Override
            public void onReward(ATAdInfo adInfo) {
                if (!isActive(session, ad)) {
                    return;
                }
                try {
                    emit(session, session.machine.rewardObserved(
                            showId(adInfo), networkFirmId(adInfo), adsourceId(adInfo)));
                } catch (Throwable invalidCallback) {
                    logInternalFailure("reward-identity", invalidCallback);
                    fail(session, ad);
                }
            }
        };
    }

    private void validateRelatedCallback(ActiveSession session, ATRewardVideoAd ad,
                                         ATAdInfo adInfo, String callback) {
        if (!isActive(session, ad)) {
            return;
        }
        try {
            String showId = showId(adInfo);
            if (!showId.equals(session.showId)) {
                throw new IllegalStateException("Provider show ID changed");
            }
        } catch (Throwable invalidCallback) {
            logInternalFailure(callback + "-identity", invalidCallback);
            fail(session, ad);
        }
    }

    private void emit(ActiveSession session, TakuTelemetry telemetry) {
        if (telemetry.getProviderShowId() != null) {
            if (session.showId == null) {
                session.showId = telemetry.getProviderShowId();
            } else if (!session.showId.equals(telemetry.getProviderShowId())) {
                throw new IllegalStateException("Provider show ID changed");
            }
        }
        Log.i(TAG, "TAKU_TELEMETRY state=" + telemetry.getState().name()
                + " callbackSequence=" + telemetry.getCallbackSequence()
                + " rewardObserved=" + telemetry.isClientRewardObserved()
                + " closed=" + telemetry.isClosed()
                + " sessionRef="
                + SafeEvidenceReference.of(telemetry.getProtocol().getSessionId())
                + " showRef=" + SafeEvidenceReference.of(telemetry.getProviderShowId())
                + " " + telemetry.safeSourceCorrelation());
        session.listener.onTelemetry(telemetry);
    }

    private void fail(ActiveSession session, ATRewardVideoAd ad) {
        fail(session, ad, TakuFailureReason.SDK_FAILURE);
    }

    private void fail(ActiveSession session, ATRewardVideoAd ad,
                      TakuFailureReason failureReason) {
        if (!isActive(session, ad)) {
            return;
        }
        try {
            TakuTelemetry failure = session.machine.failed(
                    null, null, null, failureReason);
            emit(session, failure);
        } catch (Throwable ignored) {
            logInternalFailure("terminal-callback", ignored);
        } finally {
            release(session, ad);
        }
    }

    private boolean isActive(ActiveSession session, ATRewardVideoAd ad) {
        return session != null && ad != null && !destroyed
                && activeSession == session && activeAd == ad;
    }

    private boolean canPresent(ActiveSession session) {
        return !activity.isFinishing() && !activity.isDestroyed()
                && activity.hasWindowFocus() && session.showAuthorization.canPresent();
    }

    private void release(ActiveSession session, ATRewardVideoAd ad) {
        session.presentationLease.terminate();
        if (activeSession == session) {
            activeSession = null;
        }
        if (activeAd == ad) {
            activeAd = null;
        }
        ad.destroyAd();
    }

    private void releaseActive() {
        ATRewardVideoAd ad = activeAd;
        activeAd = null;
        activeSession = null;
        if (ad != null) {
            ad.destroyAd();
        }
    }

    private static String showId(ATAdInfo adInfo) {
        String value = adInfo == null ? null : adInfo.getShowId();
        if (value == null || value.length() == 0) {
            throw new IllegalStateException("Taku provider show ID is missing");
        }
        return value;
    }

    private static Integer networkFirmId(ATAdInfo adInfo) {
        int value = adInfo == null ? 0 : adInfo.getNetworkFirmId();
        if (value <= 0) {
            throw new IllegalStateException("Taku network firm ID is missing");
        }
        return value;
    }

    private static String adsourceId(ATAdInfo adInfo) {
        String value = adInfo == null ? null : adInfo.getAdsourceId();
        if (value == null || value.length() == 0) {
            throw new IllegalStateException("Taku adsource ID is missing");
        }
        return value;
    }

    private static void logAdError(String stage, AdError error) {
        if (error == null) {
            Log.w(TAG, "Taku " + stage + " failed without an SDK error");
            return;
        }
        Log.w(TAG, "Taku " + stage + " failed: code=" + safeLogCode(error.getCode())
                + " platformCode=" + safeLogCode(error.getPlatformCode()));
    }

    private static String safeLogCode(String value) {
        if (value == null || value.length() == 0) {
            return "<none>";
        }
        return value.matches("[A-Za-z0-9._-]{1,64}") ? value : "<invalid>";
    }

    private static void logInternalFailure(String stage, Throwable error) {
        Log.w(TAG, "Taku " + stage + " failed: type=" + safeThrowableType(error));
    }

    private static String safeThrowableType(Throwable error) {
        if (error == null) {
            return "<none>";
        }
        String type = error.getClass().getSimpleName();
        return type.matches("[A-Za-z0-9_$]{1,64}") ? type : "<invalid>";
    }

    private static final class ActiveSession {
        private final AdSessionProtocol protocol;
        private final EventListener listener;
        private final ShowAuthorization showAuthorization;
        private final TakuSessionStateMachine machine;
        private final TakuPresentationLease presentationLease = new TakuPresentationLease();
        private String showId;

        private ActiveSession(AdSessionProtocol protocol, EventListener listener,
                              ShowAuthorization showAuthorization,
                              TakuSessionStateMachine machine) {
            this.protocol = protocol;
            this.listener = listener;
            this.showAuthorization = showAuthorization;
            this.machine = machine;
        }
    }
}
