package top.neoshen.xingheyingguan;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.bytedance.sdk.openadsdk.TTAdConfig;
import com.bytedance.sdk.openadsdk.TTAdSdk;
import com.bytedance.sdk.openadsdk.mediation.init.MediationConfig;

final class PangleAdSdkInitializer {
    private static final String TAG = "SkitPangleAdSdk";
    private static final String APP_NAME = "短剧 SaaS";
    private static final long INITIALIZATION_TIMEOUT_MILLIS = 15_000L;
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static final PangleSdkInitializationCoordinator INITIALIZATION =
            new PangleSdkInitializationCoordinator();
    private static final PangleSdkInitializationCoordinator.Scheduler MAIN_SCHEDULER =
            new PangleSdkInitializationCoordinator.Scheduler() {
                @Override
                public PangleSdkInitializationCoordinator.Cancellable schedule(
                        Runnable runnable, long delayMillis) {
                    if (!MAIN_HANDLER.postDelayed(runnable, delayMillis)) {
                        throw new IllegalStateException("Pangle timeout scheduling failed");
                    }
                    return () -> MAIN_HANDLER.removeCallbacks(runnable);
                }

                @Override
                public void execute(Runnable runnable) {
                    if (Looper.myLooper() == Looper.getMainLooper()) {
                        runnable.run();
                    } else if (!MAIN_HANDLER.post(runnable)) {
                        throw new IllegalStateException("Pangle main-thread dispatch failed");
                    }
                }
            };

    private PangleAdSdkInitializer() {
    }

    static Registration ensureStarted(Context context, boolean debug, Callback callback) {
        if (context == null || callback == null) {
            throw new IllegalArgumentException("Pangle context and callback are required");
        }

        final boolean globalReady;
        try {
            globalReady = TTAdSdk.isInitSuccess() || TTAdSdk.isSdkReady();
        } catch (Throwable readinessFailure) {
            Log.e(TAG, "TTAdSdk readiness check failed type="
                    + safeThrowableType(readinessFailure));
            callback.onFailure(-100, "TTAdSdk readiness check failed");
            return () -> { };
        }

        Context applicationContext = context.getApplicationContext();
        PangleSdkInitializationCoordinator.Registration registration =
                INITIALIZATION.ensureStarted(globalReady, completion -> {
                    try {
                        TTAdConfig config = new TTAdConfig.Builder()
                                .appId(BuildConfig.PANGLE_APP_ID)
                                .appName(APP_NAME)
                                .useMediation(true)
                                .setMediationConfig(new MediationConfig.Builder().build())
                                .supportMultiProcess(false)
                                .debug(debug)
                                .build();
                        boolean accepted = TTAdSdk.init(applicationContext, config);
                        Log.i(TAG, "TTAdSdk init accepted=" + accepted
                                + ", version=" + TTAdSdk.SDK_VERSION_NAME);
                        if (!accepted) {
                            completion.onFailure(-100, "TTAdSdk init was not accepted");
                            return;
                        }
                        TTAdSdk.start(new TTAdSdk.Callback() {
                            @Override
                            public void success() {
                                Log.i(TAG, "TTAdSdk start success");
                                completion.onSuccess();
                            }

                            @Override
                            public void fail(int code, String ignoredProviderMessage) {
                                Log.e(TAG, "TTAdSdk start failed code=" + code);
                                completion.onFailure(code, "TTAdSdk start failed");
                            }
                        });
                    } catch (Throwable error) {
                        Log.e(TAG, "TTAdSdk init failed type=" + safeThrowableType(error));
                        completion.onFailure(-100, "TTAdSdk init failed");
                    }
                }, MAIN_SCHEDULER, INITIALIZATION_TIMEOUT_MILLIS,
                        new PangleSdkInitializationCoordinator.Callback() {
                            @Override
                            public void onSuccess() {
                                callback.onSuccess();
                            }

                            @Override
                            public void onFailure(int code, String message) {
                                callback.onFailure(code, message);
                            }
                        });
        return registration::cancel;
    }

    interface Callback {
        void onSuccess();

        void onFailure(int code, String message);
    }

    interface Registration {
        void cancel();
    }

    private static String safeThrowableType(Throwable error) {
        String type = error == null ? "<none>" : error.getClass().getSimpleName();
        return type.matches("[A-Za-z0-9_$]{1,64}") ? type : "<invalid>";
    }
}
