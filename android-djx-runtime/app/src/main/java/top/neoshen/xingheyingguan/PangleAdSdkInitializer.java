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
    private static final int UNOWNED_READY_CODE = -101;
    private static final int OWNED_STATE_LOST_CODE = -102;

    private static final List<Callback> pendingCallbacks = new ArrayList<>();
    private static final PangleBootstrapOwnership bootstrapOwnership =
            new PangleBootstrapOwnership();

    private PangleAdSdkInitializer() {
    }

    static void ensureStarted(Context context, boolean debug, Callback callback) {
        if (callback == null) {
            throw new IllegalArgumentException("Pangle callback is required");
        }

        PangleBootstrapOwnership.Request ownershipRequest = null;
        Throwable readinessFailure = null;
        synchronized (PangleAdSdkInitializer.class) {
            try {
                boolean globalReady = TTAdSdk.isInitSuccess() || TTAdSdk.isSdkReady();
                ownershipRequest = bootstrapOwnership.request(globalReady);
            } catch (Throwable error) {
                readinessFailure = error;
            }
            if (ownershipRequest != null
                    && (ownershipRequest.getDecision()
                    == PangleBootstrapOwnership.Decision.START_OWNED
                    || ownershipRequest.getDecision()
                    == PangleBootstrapOwnership.Decision.JOIN_OWNED_START)) {
                pendingCallbacks.add(callback);
                if (ownershipRequest.getDecision()
                        == PangleBootstrapOwnership.Decision.JOIN_OWNED_START) {
                    return;
                }
            }
        }

        if (readinessFailure != null) {
            Log.e(TAG, "TTAdSdk readiness check failed type="
                    + safeThrowableType(readinessFailure));
            callback.onFailure(-100, "TTAdSdk readiness check failed");
            return;
        }
        if (ownershipRequest == null) {
            callback.onFailure(-100, "TTAdSdk ownership decision failed");
            return;
        }

        if (ownershipRequest.getDecision() == PangleBootstrapOwnership.Decision.REUSE_OWNED) {
            callback.onSuccess();
            return;
        }
        if (ownershipRequest.getDecision()
                == PangleBootstrapOwnership.Decision.REJECT_UNOWNED_READY) {
            callback.onFailure(UNOWNED_READY_CODE, "TTAdSdk has no owned bootstrap identity");
            return;
        }
        if (ownershipRequest.getDecision()
                == PangleBootstrapOwnership.Decision.REJECT_OWNED_STATE_LOST) {
            callback.onFailure(OWNED_STATE_LOST_CODE, "TTAdSdk owned state is unavailable");
            return;
        }

        final long attempt = ownershipRequest.getAttempt();
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
            if (!accepted) {
                completeFailure(attempt, UNOWNED_READY_CODE, "TTAdSdk init was not accepted");
                return;
            }
            TTAdSdk.start(new TTAdSdk.Callback() {
                @Override
                public void success() {
                    Log.i(TAG, "TTAdSdk start success");
                    completeSuccess(attempt);
                }

                @Override
                public void fail(int code, String message) {
                    Log.e(TAG, "TTAdSdk start failed code=" + code);
                    completeFailure(attempt, code, "TTAdSdk start failed");
                }
            });
        } catch (Throwable error) {
            Log.e(TAG, "TTAdSdk init failed type=" + safeThrowableType(error));
            completeFailure(attempt, -100, "TTAdSdk init failed");
        }
    }

    private static void completeSuccess(long attempt) {
        List<Callback> callbacks;
        synchronized (PangleAdSdkInitializer.class) {
            if (!bootstrapOwnership.completeSuccess(attempt)) {
                return;
            }
            callbacks = drainCallbacksLocked();
        }
        for (Callback callback : callbacks) {
            callback.onSuccess();
        }
    }

    private static void completeFailure(long attempt, int code, String message) {
        List<Callback> callbacks;
        synchronized (PangleAdSdkInitializer.class) {
            if (!bootstrapOwnership.completeFailure(attempt)) {
                return;
            }
            callbacks = drainCallbacksLocked();
        }
        for (Callback callback : callbacks) {
            callback.onFailure(code, message == null ? "TTAdSdk init failed" : message);
        }
    }

    private static List<Callback> drainCallbacksLocked() {
        List<Callback> callbacks = new ArrayList<>(pendingCallbacks);
        pendingCallbacks.clear();
        return callbacks;
    }

    interface Callback {
        void onSuccess();

        void onFailure(int code, String message);
    }

    private static String safeThrowableType(Throwable error) {
        String type = error == null ? "<none>" : error.getClass().getSimpleName();
        return type.matches("[A-Za-z0-9_$]{1,64}") ? type : "<invalid>";
    }
}
