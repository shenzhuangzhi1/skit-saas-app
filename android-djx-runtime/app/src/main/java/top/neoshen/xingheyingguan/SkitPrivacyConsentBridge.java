package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

import top.neoshen.xingheyingguan.ad.ThirdPartySdkBootstrap;

/** Accepts only an explicit boolean from the trusted local H5 privacy boundary. */
public final class SkitPrivacyConsentBridge {
    private static final String TAG = "SkitPrivacyConsent";

    private final Activity activity;
    private final WebView webView;
    private final BridgeOriginGuard originGuard;
    private final ThirdPartySdkBootstrap thirdPartySdkBootstrap;

    SkitPrivacyConsentBridge(Activity activity, WebView webView,
                             BridgeOriginGuard originGuard,
                             ThirdPartySdkBootstrap thirdPartySdkBootstrap) {
        this.activity = activity;
        this.webView = webView;
        this.originGuard = originGuard;
        this.thirdPartySdkBootstrap = thirdPartySdkBootstrap;
    }

    void postMessage(String rawMessage) {
        String callbackId = "";
        try {
            originGuard.requireTrustedTopLevel();
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            callbackId = message.optString("id", "");
            if (!callbackId.matches("[A-Za-z0-9._:-]{1,128}")) {
                throw new IllegalArgumentException("Invalid native callback ID");
            }
            if (!"setAdPrivacyConsent".equals(message.optString("method", ""))) {
                throw new IllegalArgumentException("Unknown privacy method");
            }
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null || payload.length() != 2 || !payload.has("granted")
                    || !payload.has("consentVersion")
                    || !(payload.get("granted") instanceof Boolean)
                    || !(payload.get("consentVersion") instanceof Integer)
                    || payload.getInt("consentVersion") != 1) {
                throw new IllegalArgumentException("Explicit boolean consent is required");
            }
            boolean granted = payload.getBoolean("granted");
            thirdPartySdkBootstrap.deliverConsent(granted);
            JSONObject result = new JSONObject();
            result.put("success", true);
            result.put("granted", granted);
            result.put("consentVersion", 1);
            resolve(callbackId, result);
        } catch (SecurityException rejectedOrigin) {
            Log.w(TAG, "Rejected privacy bridge call from an untrusted top-level document");
        } catch (Throwable invalidMessage) {
            Log.w(TAG, "Rejected invalid privacy bridge message");
            if (!callbackId.isEmpty()) {
                JSONObject result = new JSONObject();
                put(result, "success", false);
                resolve(callbackId, result);
            }
        }
    }

    private void resolve(String id, JSONObject result) {
        String javascript = "window.__SkitNativeBridgeResolve && window.__SkitNativeBridgeResolve("
                + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ");";
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                webView.evaluateJavascript(javascript, null);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Dropped privacy callback after top-level origin changed");
            }
        });
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Throwable ignored) {
        }
    }
}
