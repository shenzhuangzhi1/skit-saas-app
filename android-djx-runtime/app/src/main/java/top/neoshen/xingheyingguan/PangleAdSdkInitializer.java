package top.neoshen.xingheyingguan;

import android.content.Context;
import android.util.Log;

import com.bytedance.sdk.openadsdk.TTAdConfig;
import com.bytedance.sdk.openadsdk.TTAdSdk;
import com.bytedance.sdk.openadsdk.mediation.init.MediationConfig;

import java.util.ArrayList;
import java.util.List;

final class PangleAdSdkInitializer {
    private static final String TAG = "SkitPangleAdSdk";
    private static final String APP_NAME = "短剧 SaaS";

    private static final List<Callback> pendingCallbacks = new ArrayList<>();
    private static boolean starting;

    private PangleAdSdkInitializer() {
    }

    static void ensureStarted(Context context, boolean debug, Callback callback) {
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
            TTAdConfig config = new TTAdConfig.Builder()
                    .appId(BuildConfig.PANGLE_APP_ID)
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
