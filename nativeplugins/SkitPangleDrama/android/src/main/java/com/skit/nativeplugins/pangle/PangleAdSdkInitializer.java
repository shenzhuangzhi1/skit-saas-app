package com.skit.nativeplugins.pangle;

import android.content.Context;
import android.util.Log;

import com.bytedance.sdk.openadsdk.TTAdConfig;
import com.bytedance.sdk.openadsdk.TTAdSdk;
import com.bytedance.sdk.openadsdk.mediation.init.MediationConfig;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class PangleAdSdkInitializer {
    private static final String TAG = "SkitPangleAdSdk";
    private static final String APP_NAME = "短剧 SaaS";

    private static final List<Callback> pendingCallbacks = new ArrayList<>();
    private static boolean starting;

    private PangleAdSdkInitializer() {
    }

    static void ensureStarted(Context context, boolean debug, String settingFile, Callback callback) {
        if (TTAdSdk.isInitSuccess() || TTAdSdk.isSdkReady()) {
            callback.onSuccess();
            return;
        }

        synchronized (PangleAdSdkInitializer.class) {
            if (TTAdSdk.isInitSuccess() || TTAdSdk.isSdkReady()) {
                callback.onSuccess();
                return;
            }
            pendingCallbacks.add(callback);
            if (starting) {
                return;
            }
            starting = true;
        }

        try {
            String pangleAppId = readPangleAppId(context, settingFile);
            TTAdConfig config = new TTAdConfig.Builder()
                    .appId(pangleAppId)
                    .appName(APP_NAME)
                    .useMediation(true)
                    .setMediationConfig(new MediationConfig.Builder().build())
                    .supportMultiProcess(false)
                    .debug(debug)
                    .build();
            boolean accepted = TTAdSdk.init(context.getApplicationContext(), config);
            Log.i(TAG, "TTAdSdk init accepted=" + accepted + ", version=" + TTAdSdk.SDK_VERSION_NAME);
            TTAdSdk.start(new TTAdSdk.Callback() {
                @Override
                public void success() {
                    Log.i(TAG, "TTAdSdk start success");
                    completeSuccess();
                }

                @Override
                public void fail(int code, String message) {
                    Log.e(TAG, "TTAdSdk start failed " + code + " " + message);
                    completeFailure(code, message == null ? "TTAdSdk start failed" : message);
                }
            });
        } catch (Throwable error) {
            Log.e(TAG, "TTAdSdk init failed", error);
            completeFailure(-100, error.getMessage());
        }
    }

    private static String readPangleAppId(Context context, String settingFile) throws Exception {
        try (InputStream input = context.getAssets().open(settingFile);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            JSONObject root = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            JSONObject init = root.optJSONObject("init");
            String appId = init == null ? "" : init.optString("site_id", "");
            if (appId.length() == 0) {
                throw new IllegalArgumentException("Pangle setting is missing init.site_id");
            }
            return appId;
        }
    }

    private static void completeSuccess() {
        List<Callback> callbacks = drainCallbacks();
        for (Callback callback : callbacks) {
            callback.onSuccess();
        }
    }

    private static void completeFailure(int code, String message) {
        List<Callback> callbacks = drainCallbacks();
        for (Callback callback : callbacks) {
            callback.onFailure(code, message == null ? "TTAdSdk init failed" : message);
        }
    }

    private static synchronized List<Callback> drainCallbacks() {
        starting = false;
        List<Callback> callbacks = new ArrayList<>(pendingCallbacks);
        pendingCallbacks.clear();
        return callbacks;
    }

    interface Callback {
        void onSuccess();

        void onFailure(int code, String message);
    }
}
