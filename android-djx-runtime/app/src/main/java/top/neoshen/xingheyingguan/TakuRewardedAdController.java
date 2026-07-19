package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.Context;
import android.util.Log;

import com.anythink.core.api.ATAdConst;
import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.ATDebuggerConfig;
import com.anythink.core.api.ATSDK;
import com.anythink.core.api.ATShowConfig;
import com.anythink.core.api.AdError;
import com.anythink.rewardvideo.api.ATRewardVideoAd;
import com.anythink.rewardvideo.api.ATRewardVideoListener;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Map;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;

/** Owns one Taku ad object at a time and never reuses it across server sessions. */
final class TakuRewardedAdController {
    static final String APP_ID = BuildConfig.TAKU_APP_ID;
    static final String APP_KEY = BuildConfig.TAKU_APP_KEY;

    private static final String TAG = "SkitTakuAd";
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static boolean initialized;

    interface EventListener {
        void onTelemetry(TakuTelemetry telemetry);
    }

    private final Activity activity;
    private ATRewardVideoAd activeAd;
    private ActiveSession activeSession;
    private boolean destroyed;

    TakuRewardedAdController(Activity activity) {
        this.activity = activity;
    }

    static synchronized void initialize(Context context) {
        if (initialized) {
            return;
        }
        boolean debuggerEnabled = BuildConfig.DEBUG
                && BuildConfig.TAKU_DEBUG_NETWORK_FIRM_ID > 0
                && !BuildConfig.TAKU_DEBUG_DEVICE_ID.isEmpty();
        if (debuggerEnabled) {
            ATSDK.setDebuggerConfig(
                    context.getApplicationContext(),
                    BuildConfig.TAKU_DEBUG_DEVICE_ID,
                    new ATDebuggerConfig.Builder(BuildConfig.TAKU_DEBUG_NETWORK_FIRM_ID).build());
        }
        ATSDK.setNetworkLogDebug(BuildConfig.DEBUG);
        ATSDK.init(context.getApplicationContext(), APP_ID, APP_KEY);
        try {
            ATSDK.start();
        } catch (Throwable error) {
            Log.w(TAG, "Taku SDK start failed", error);
        }
        initialized = true;
        Log.i(TAG, "Taku SDK initialized: " + ATSDK.getSDKVersionName());
    }

    void start(AdSessionProtocol protocol, EventListener listener) {
        if (destroyed) {
            throw new IllegalStateException("Taku controller is destroyed");
        }
        if (protocol == null || listener == null) {
            throw new IllegalArgumentException("Protocol and listener are required");
        }
        if (activeSession != null || activeAd != null) {
            throw new IllegalStateException("Another Taku session is active");
        }

        initialize(activity);
        String sdkRequestId = "native-" + protocol.getSessionId();
        ActiveSession session = new ActiveSession(
                protocol, listener, new TakuSessionStateMachine(protocol, sdkRequestId));
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
            Log.w(TAG, "Taku load failed", error);
            fail(session, ad, null);
        }
    }

    void destroy() {
        destroyed = true;
        releaseActive();
    }

    void cancelActiveSession() {
        releaseActive();
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
                    AdSessionProtocol protocol = session.protocol;
                    ATShowConfig showConfig = new ATShowConfig.Builder()
                            .showCustomExt(protocol.getSessionId())
                            .build();
                    ad.show(activity, showConfig);
                } catch (Throwable error) {
                    Log.w(TAG, "Taku show failed", error);
                    fail(session, ad, null);
                }
            }

            @Override
            public void onRewardedVideoAdFailed(AdError error) {
                logAdError("load", error);
                fail(session, ad, null);
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
                    Log.w(TAG, "Taku play-start identity rejected", invalidCallback);
                    fail(session, ad, adInfo);
                }
            }

            @Override
            public void onRewardedVideoAdPlayEnd(ATAdInfo adInfo) {
                validateRelatedCallback(session, ad, adInfo, "play-end");
            }

            @Override
            public void onRewardedVideoAdPlayFailed(AdError error, ATAdInfo adInfo) {
                logAdError("play", error);
                fail(session, ad, adInfo);
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
                    Log.w(TAG, "Taku close identity rejected", invalidCallback);
                    fail(session, ad, adInfo);
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
                    Log.w(TAG, "Taku reward identity rejected", invalidCallback);
                    fail(session, ad, adInfo);
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
            Log.w(TAG, "Taku " + callback + " identity rejected", invalidCallback);
            fail(session, ad, adInfo);
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
                + " showRef=" + showReference(telemetry.getProviderShowId()));
        session.listener.onTelemetry(telemetry);
    }

    private void fail(ActiveSession session, ATRewardVideoAd ad, ATAdInfo adInfo) {
        if (!isActive(session, ad)) {
            return;
        }
        try {
            TakuTelemetry failure;
            if (adInfo == null || session.showId == null) {
                failure = session.machine.failed(null, null, null);
            } else {
                failure = session.machine.failed(
                        showId(adInfo), networkFirmId(adInfo), adsourceId(adInfo));
            }
            emit(session, failure);
        } catch (Throwable ignored) {
            Log.w(TAG, "Taku terminal failure callback was rejected", ignored);
        } finally {
            release(session, ad);
        }
    }

    private boolean isActive(ActiveSession session, ATRewardVideoAd ad) {
        return !destroyed && activeSession == session && activeAd == ad;
    }

    private void release(ActiveSession session, ATRewardVideoAd ad) {
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

    private static String showReference(String providerShowId) {
        if (providerShowId == null) {
            return "<none>";
        }
        final byte[] digest;
        try {
            digest = MessageDigest.getInstance("SHA-256")
                    .digest(providerShowId.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 is unavailable", unavailable);
        }
        char[] reference = new char[12];
        for (int index = 0; index < 6; index += 1) {
            int value = digest[index] & 0xff;
            reference[index * 2] = HEX[value >>> 4];
            reference[index * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(reference);
    }

    private static final class ActiveSession {
        private final AdSessionProtocol protocol;
        private final EventListener listener;
        private final TakuSessionStateMachine machine;
        private String showId;

        private ActiveSession(AdSessionProtocol protocol, EventListener listener,
                              TakuSessionStateMachine machine) {
            this.protocol = protocol;
            this.listener = listener;
            this.machine = machine;
        }
    }
}
