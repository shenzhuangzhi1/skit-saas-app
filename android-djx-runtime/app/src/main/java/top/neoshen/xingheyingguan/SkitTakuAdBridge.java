package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.anythink.core.api.ATAdInfo;
import com.anythink.core.api.AdError;

import org.json.JSONObject;

public class SkitTakuAdBridge {
    private static final String TAG = "SkitTakuAd";

    private final Activity activity;
    private final WebView webView;
    private final TakuRewardedAdController rewardedAdController;
    private String pendingCallbackId;
    private String pendingPlacementId;

    public SkitTakuAdBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.rewardedAdController = new TakuRewardedAdController(activity);
    }

    @JavascriptInterface
    public void postMessage(String rawMessage) {
        activity.runOnUiThread(() -> handleMessage(rawMessage));
    }

    private void handleMessage(String rawMessage) {
        try {
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            String method = message.optString("method", "");
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null) {
                payload = new JSONObject();
            }

            if ("showRewardedVideo".equals(method)) {
                showRewardedVideo(id, payload);
                return;
            }
            resolve(id, fail(-404, "Unknown native method: " + method));
        } catch (Throwable error) {
            Log.e(TAG, "postMessage failed", error);
        }
    }

    private void showRewardedVideo(String id, JSONObject payload) {
        if (pendingCallbackId != null) {
            resolve(id, fail(-409, "Taku rewarded video is already loading or showing"));
            return;
        }

        pendingCallbackId = id;
        pendingPlacementId = payload.optString("placementId", TakuRewardedAdController.DEFAULT_REWARD_PLACEMENT_ID);
        rewardedAdController.show(pendingPlacementId, new TakuRewardedAdController.RewardListener() {
            @Override
            public void onAdStarted(ATAdInfo adInfo) {
                Log.i(TAG, "rewarded video play start " + adInfoJson(adInfo));
            }

            @Override
            public void onReward(ATAdInfo adInfo) {
                // The result is deliberately resolved on close, after the reward state is final.
            }

            @Override
            public void onAdClosed(ATAdInfo adInfo, boolean rewarded) {
                JSONObject result = ok();
                put(result, "completed", rewarded);
                put(result, "rewarded", rewarded);
                put(result, "closed", true);
                put(result, "provider", "taku");
                put(result, "placementId", pendingPlacementId);
                put(result, "adInfo", adInfoJson(adInfo));
                finish(result);
            }

            @Override
            public void onAdFailed(AdError error) {
                finish(fail(errorCode(error), errorMessage(error, "Taku rewarded video play failed")));
            }
        });
    }

    private void finish(JSONObject result) {
        String id = pendingCallbackId;
        pendingCallbackId = null;
        pendingPlacementId = null;
        resolve(id, result);
    }

    private JSONObject adInfoJson(ATAdInfo adInfo) {
        JSONObject result = new JSONObject();
        if (adInfo == null) {
            return result;
        }
        put(result, "networkFirmId", adInfo.getNetworkFirmId());
        put(result, "networkName", adInfo.getNetworkName());
        put(result, "placementId", adInfo.getPlacementId());
        put(result, "topOnPlacementId", adInfo.getTopOnPlacementId());
        put(result, "adsourceId", adInfo.getAdsourceId());
        put(result, "requestId", adInfo.getRequestId());
        put(result, "ecpm", adInfo.getEcpm());
        put(result, "currency", adInfo.getCurrency());
        return result;
    }

    private int errorCode(AdError error) {
        if (error == null) {
            return -5;
        }
        try {
            return Integer.parseInt(error.getCode());
        } catch (Throwable ignored) {
            return -5;
        }
    }

    private String errorMessage(AdError error, String fallback) {
        if (error == null) {
            return fallback;
        }
        String full = error.getFullErrorInfo();
        if (full != null && full.length() > 0) {
            return full;
        }
        String desc = error.getDesc();
        return desc == null || desc.length() == 0 ? fallback : desc;
    }

    private JSONObject ok() {
        JSONObject result = new JSONObject();
        put(result, "success", true);
        return result;
    }

    private JSONObject fail(int code, String message) {
        JSONObject result = new JSONObject();
        put(result, "success", false);
        put(result, "completed", false);
        put(result, "closed", false);
        put(result, "provider", "taku");
        put(result, "placementId", TakuRewardedAdController.DEFAULT_REWARD_PLACEMENT_ID);
        put(result, "code", code);
        put(result, "message", message == null ? "unknown error" : message);
        return result;
    }

    private void resolve(String id, JSONObject result) {
        if (id == null || id.length() == 0) {
            return;
        }
        activity.runOnUiThread(() -> {
            String script = "window.__SkitNativeBridgeResolve && window.__SkitNativeBridgeResolve("
                    + JSONObject.quote(id)
                    + ","
                    + JSONObject.quote(result.toString())
                    + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Throwable ignored) {
        }
    }
}
