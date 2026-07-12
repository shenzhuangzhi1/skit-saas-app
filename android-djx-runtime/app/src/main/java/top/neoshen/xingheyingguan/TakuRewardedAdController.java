package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.Context;
import android.util.Log;

import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.ATSDK;
import com.anythink.core.api.AdError;
import com.anythink.rewardvideo.api.ATRewardVideoAd;
import com.anythink.rewardvideo.api.ATRewardVideoListener;

/**
 * Owns the Taku rewarded-video lifecycle for one visible Activity.
 *
 * The SDK keeps its ad instance and listener weakly, so this object must be retained by the
 * Activity that asks it to load or show an advertisement.
 */
final class TakuRewardedAdController {
    static final String APP_ID = BuildConfig.TAKU_APP_ID;
    static final String APP_KEY = BuildConfig.TAKU_APP_KEY;
    static final String DEFAULT_REWARD_PLACEMENT_ID = BuildConfig.TAKU_REWARD_PLACEMENT_ID;

    private static final String TAG = "SkitTakuAd";
    private static boolean initialized;

    interface RewardListener {
        void onAdStarted(ATAdInfo adInfo);

        void onReward(ATAdInfo adInfo);

        void onAdClosed(ATAdInfo adInfo, boolean rewarded);

        void onAdFailed(AdError error);
    }

    private final Activity activity;
    private ATRewardVideoAd rewardVideoAd;
    private String placementId = DEFAULT_REWARD_PLACEMENT_ID;
    private RewardListener pendingListener;
    private boolean loading;
    private boolean showing;
    private boolean rewardGranted;
    private boolean destroyed;

    TakuRewardedAdController(Activity activity) {
        this.activity = activity;
    }

    static synchronized void initialize(Context context) {
        if (initialized) {
            return;
        }
        ATSDK.setNetworkLogDebug(BuildConfig.DEBUG);
        ATSDK.init(context.getApplicationContext(), APP_ID, APP_KEY);
        try {
            // Required by current mainland-China SDK releases after ATSDK.init().
            ATSDK.start();
        } catch (Throwable error) {
            Log.w(TAG, "Taku SDK start failed", error);
        }
        initialized = true;
        Log.i(TAG, "Taku SDK initialized: " + ATSDK.getSDKVersionName());
    }

    void preload() {
        if (destroyed) {
            return;
        }
        initialize(activity);
        ensureRewardAd(DEFAULT_REWARD_PLACEMENT_ID);
        loadIfNeeded();
    }

    void show(String desiredPlacementId, RewardListener listener) {
        if (listener == null) {
            return;
        }
        if (destroyed) {
            listener.onAdFailed(null);
            return;
        }
        if (pendingListener != null || showing) {
            listener.onAdFailed(null);
            return;
        }

        initialize(activity);
        ensureRewardAd(desiredPlacementId == null || desiredPlacementId.length() == 0
                ? DEFAULT_REWARD_PLACEMENT_ID : desiredPlacementId);
        pendingListener = listener;
        rewardGranted = false;

        if (rewardVideoAd != null && rewardVideoAd.isAdReady()) {
            showLoadedAd();
            return;
        }
        loadIfNeeded();
    }

    void destroy() {
        destroyed = true;
        pendingListener = null;
        loading = false;
        showing = false;
        rewardGranted = false;
        if (rewardVideoAd != null) {
            rewardVideoAd.destroyAd();
            rewardVideoAd = null;
        }
    }

    private void ensureRewardAd(String desiredPlacementId) {
        if (rewardVideoAd != null && desiredPlacementId.equals(placementId)) {
            return;
        }
        if (rewardVideoAd != null) {
            rewardVideoAd.destroyAd();
        }
        placementId = desiredPlacementId;
        rewardVideoAd = new ATRewardVideoAd(activity, placementId);
        rewardVideoAd.setAdListener(new ATRewardVideoListener() {
            @Override
            public void onRewardedVideoAdLoaded() {
                loading = false;
                if (destroyed) {
                    return;
                }
                Log.i(TAG, "rewarded video loaded placementId=" + placementId);
                if (pendingListener != null && !showing) {
                    showLoadedAd();
                }
            }

            @Override
            public void onRewardedVideoAdFailed(AdError error) {
                loading = false;
                Log.w(TAG, "rewarded video load failed: " + errorMessage(error));
                finishFailure(error);
            }

            @Override
            public void onRewardedVideoAdPlayStart(ATAdInfo adInfo) {
                showing = true;
                Log.i(TAG, "rewarded video play start");
                if (pendingListener != null) {
                    pendingListener.onAdStarted(adInfo);
                }
            }

            @Override
            public void onRewardedVideoAdPlayEnd(ATAdInfo adInfo) {
                Log.i(TAG, "rewarded video play end");
            }

            @Override
            public void onRewardedVideoAdPlayFailed(AdError error, ATAdInfo adInfo) {
                Log.w(TAG, "rewarded video play failed: " + errorMessage(error));
                finishFailure(error);
            }

            @Override
            public void onRewardedVideoAdClosed(ATAdInfo adInfo) {
                RewardListener listener = pendingListener;
                boolean rewarded = rewardGranted;
                pendingListener = null;
                showing = false;
                rewardGranted = false;
                if (listener != null) {
                    listener.onAdClosed(adInfo, rewarded);
                }
                if (!destroyed) {
                    preload();
                }
            }

            @Override
            public void onRewardedVideoAdPlayClicked(ATAdInfo adInfo) {
                Log.i(TAG, "rewarded video clicked");
            }

            @Override
            public void onReward(ATAdInfo adInfo) {
                rewardGranted = true;
                if (pendingListener != null) {
                    pendingListener.onReward(adInfo);
                }
            }
        });
    }

    private void loadIfNeeded() {
        if (rewardVideoAd == null || loading || showing || rewardVideoAd.isAdReady()) {
            return;
        }
        try {
            loading = true;
            rewardVideoAd.load(activity);
        } catch (Throwable error) {
            loading = false;
            Log.e(TAG, "rewarded video load threw", error);
            finishFailure(null);
        }
    }

    private void showLoadedAd() {
        if (rewardVideoAd == null || pendingListener == null || showing) {
            return;
        }
        try {
            rewardVideoAd.show(activity);
        } catch (Throwable error) {
            Log.e(TAG, "rewarded video show threw", error);
            finishFailure(null);
        }
    }

    private void finishFailure(AdError error) {
        RewardListener listener = pendingListener;
        pendingListener = null;
        showing = false;
        rewardGranted = false;
        if (listener != null) {
            listener.onAdFailed(error);
        }
    }

    private static String errorMessage(AdError error) {
        if (error == null) {
            return "unknown error";
        }
        String full = error.getFullErrorInfo();
        return full == null || full.length() == 0 ? error.getDesc() : full;
    }
}
