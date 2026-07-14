package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.app.Fragment;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;

import com.bytedance.sdk.djx.DJXRewardAdResult;
import com.bytedance.sdk.djx.DJXSdk;
import com.bytedance.sdk.djx.IDJXWidget;
import com.bytedance.sdk.djx.interfaces.listener.IDJXAdListener;
import com.bytedance.sdk.djx.interfaces.listener.IDJXDramaListener;
import com.bytedance.sdk.djx.interfaces.listener.IDJXDramaUnlockListener;
import com.bytedance.sdk.djx.model.DJXDrama;
import com.bytedance.sdk.djx.model.DJXDramaDetailConfig;
import com.bytedance.sdk.djx.model.DJXDramaUnlockAdMode;
import com.bytedance.sdk.djx.model.DJXDramaUnlockInfo;
import com.bytedance.sdk.djx.model.DJXDramaUnlockMethod;
import com.bytedance.sdk.djx.model.DJXUnlockModeType;
import com.bytedance.sdk.djx.params.DJXWidgetDramaDetailParams;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.NativePlayerGrant;
import top.neoshen.xingheyingguan.ad.NativeRewardGate;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;

/** DJX content player whose unlock authority is the server entitlement endpoint. */
public class DramaPlayerActivity extends Activity {
    private static final String TAG = "SkitDramaPlayer";
    private static final long[] STATUS_POLL_DELAYS_MS = {500L, 1_000L, 2_000L, 3_000L, 3_000L};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private IDJXWidget widget;
    private TakuRewardedAdController takuRewardedAdController;
    private SkitNativeApiClient nativeApiClient;
    private NativePlayerGrant playerGrant;
    private FrameLayout root;
    private long dramaId;
    private int initialEpisode;
    private int lockSet;
    private boolean destroyed;
    private IDJXDramaUnlockListener.CustomAdCallback activeUnlockCallback;
    private AdSessionProtocol activeProtocol;
    private String activeProviderShowId;
    private int pollAttempt;
    private long nextUnlockGeneration;
    private long unlockGeneration;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setId(View.generateViewId());
        setContentView(root, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        if (!DJXSdk.isStartSuccess()) {
            finish();
            return;
        }
        dramaId = getIntent().getLongExtra("dramaId", 0L);
        initialEpisode = getIntent().getIntExtra("episode", 1);
        int freeSet = getIntent().getIntExtra("freeSet", 8);
        lockSet = Math.max(1, getIntent().getIntExtra("lockSet", 5));
        int progress = getIntent().getIntExtra("progress", 0);
        if (dramaId <= 0L || initialEpisode <= 0) {
            finish();
            return;
        }
        try {
            playerGrant = readPlayerGrant();
            playerGrant.requireDrama(dramaId);
            nativeApiClient = new SkitNativeApiClient(this, playerGrant);
        } catch (Throwable invalidGrant) {
            failAndFinish("播放器权限无效，请返回重试");
            return;
        }

        takuRewardedAdController = new TakuRewardedAdController(this);
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> ignoredServerEntitlements) {
                if (!destroyed) {
                    initializePlayer(freeSet, progress);
                }
            }

            @Override
            public void onFailure() {
                if (!destroyed) {
                    failAndFinish("播放器权限已失效，请返回重试");
                }
            }
        });
    }

    private NativePlayerGrant readPlayerGrant() {
        return new NativePlayerGrant(
                getIntent().getLongExtra("playerGrantId", 0L),
                getIntent().getLongExtra("playerGrantDramaId", 0L),
                getIntent().getStringExtra("playerGrantToken"),
                getIntent().getLongExtra("playerGrantExpiresAt", 0L),
                System.currentTimeMillis());
    }

    private void initializePlayer(int freeSet, int progress) {
        DJXDramaDetailConfig detailConfig = DJXDramaDetailConfig
                .obtain(DJXDramaUnlockAdMode.MODE_SPECIFIC, freeSet,
                        createUnlockListener(dramaId, lockSet))
                .infiniteScrollEnabled(false)
                .hideCellularToast(true)
                .adListener(createAdListener())
                .listener(new IDJXDramaListener() {
                    @Override
                    public void onDJXClose() {
                        finish();
                    }

                    @Override
                    public void onDJXRequestFail(int code, String message,
                                                 Map<String, Object> extra) {
                        Log.w(TAG, "DJX request failed code=" + code);
                    }
                });

        DJXWidgetDramaDetailParams params = DJXWidgetDramaDetailParams
                .obtain(dramaId, initialEpisode, detailConfig)
                .currentDuration(progress);
        widget = DJXSdk.factory().createDramaDetail(params);
        Fragment fragment = widget.getFragment2();
        getFragmentManager().beginTransaction()
                .replace(root.getId(), fragment, String.valueOf(root.getId()))
                .commit();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private IDJXDramaUnlockListener createUnlockListener(long fallbackDramaId,
                                                          int fallbackLockSet) {
        int safeLockSet = Math.max(1, fallbackLockSet);
        return new IDJXDramaUnlockListener() {
            @Override
            public void unlockFlowStart(DJXDrama drama,
                                        IDJXDramaUnlockListener.UnlockCallback callback,
                                        Map<String, ? extends Object> extra) {
                long targetDramaId = drama == null || drama.id <= 0L ? fallbackDramaId : drama.id;
                if (callback != null) {
                    callback.onConfirm(new DJXDramaUnlockInfo(
                            targetDramaId,
                            safeLockSet,
                            DJXDramaUnlockMethod.METHOD_AD,
                            false,
                            null,
                            false,
                            DJXUnlockModeType.UNLOCKTYPE_CONTINUES));
                }
            }

            @Override
            public void unlockFlowEnd(DJXDrama drama,
                                      IDJXDramaUnlockListener.UnlockErrorStatus status,
                                      Map<String, ? extends Object> extra) {
                Log.i(TAG, "server-gated unlock flow ended status=" + status);
            }

            @Override
            public void showCustomAd(DJXDrama drama,
                                     IDJXDramaUnlockListener.CustomAdCallback callback) {
                if (callback == null || activeUnlockCallback != null || destroyed) {
                    if (callback != null) {
                        callback.onError();
                    }
                    return;
                }
                long targetDramaId = drama == null || drama.id <= 0L ? fallbackDramaId : drama.id;
                int targetEpisode = drama == null || drama.index <= 0
                        ? initialEpisode : drama.index;
                if (targetDramaId != dramaId) {
                    callback.onError();
                    return;
                }
                unlockGeneration = ++nextUnlockGeneration;
                activeUnlockCallback = callback;
                verifyExistingEntitlementOrStartAd(targetEpisode, unlockGeneration);
            }
        };
    }

    private void verifyExistingEntitlementOrStartAd(int targetEpisode, long generation) {
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> grantedEpisodes) {
                if (!isActiveUnlock(generation)) {
                    return;
                }
                if (grantedEpisodes.contains(targetEpisode)) {
                    completeFromServerEntitlement(generation, null, null);
                    return;
                }
                createServerAdSession(targetEpisode, generation);
            }

            @Override
            public void onFailure() {
                failActiveUnlock(generation, "服务端权益校验失败");
            }
        });
    }

    private void createServerAdSession(int targetEpisode, long generation) {
        nativeApiClient.createAdSession(dramaId, targetEpisode,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.CreateResult>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.CreateResult result) {
                        if (!isActiveUnlock(generation)) {
                            return;
                        }
                        if ("ALREADY_ENTITLED".equals(result.getOutcome())) {
                            completeFromServerEntitlement(generation, null, null);
                            return;
                        }
                        activeProtocol = result.getProtocol();
                        activeProviderShowId = null;
                        pollAttempt = 0;
                        try {
                            takuRewardedAdController.start(activeProtocol,
                                    DramaPlayerActivity.this::onTakuTelemetry);
                        } catch (Throwable startFailure) {
                            failActiveUnlock(generation, "广告暂不可用");
                        }
                    }

                    @Override
                    public void onFailure() {
                        failActiveUnlock(generation, "广告会话创建失败");
                    }
                });
    }

    private void onTakuTelemetry(TakuTelemetry telemetry) {
        if (destroyed || activeUnlockCallback == null || activeProtocol == null
                || !activeProtocol.getSessionId().equals(telemetry.getProtocol().getSessionId())) {
            return;
        }
        if (telemetry.getProviderShowId() != null) {
            if (activeProviderShowId == null) {
                activeProviderShowId = telemetry.getProviderShowId();
                activeUnlockCallback.onShow(activeProviderShowId);
            } else if (!activeProviderShowId.equals(telemetry.getProviderShowId())) {
                failActiveUnlock(unlockGeneration, "广告展示编号不一致");
                return;
            }
        }
        long generation = unlockGeneration;
        nativeApiClient.recordTelemetry(telemetry,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.SessionStatus>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.SessionStatus ignored) {
                        afterTelemetryRecorded(telemetry, generation);
                    }

                    @Override
                    public void onFailure() {
                        afterTelemetryRecorded(telemetry, generation);
                    }
                });
    }

    private void afterTelemetryRecorded(TakuTelemetry telemetry, long generation) {
        if (!isActiveUnlock(generation) || activeProtocol == null
                || !activeProtocol.getSessionId().equals(
                        telemetry.getProtocol().getSessionId())) {
            return;
        }
        if (telemetry.getState() == TakuNativeState.ERROR) {
            failActiveUnlock(generation, "广告播放失败");
        } else if (telemetry.getState() == TakuNativeState.CLOSED) {
            scheduleNextPoll(generation, activeProtocol.getSessionId(), activeProviderShowId);
        }
    }

    private void scheduleNextPoll(long generation, String expectedSessionId,
                                  String expectedShowId) {
        if (!isActiveAd(generation, expectedSessionId, expectedShowId)) {
            return;
        }
        if (pollAttempt >= STATUS_POLL_DELAYS_MS.length) {
            failActiveUnlock(generation, "奖励仍在服务端验证中，请稍后重试");
            return;
        }
        long delay = STATUS_POLL_DELAYS_MS[pollAttempt++];
        handler.postDelayed(
                () -> pollServerReward(generation, expectedSessionId, expectedShowId), delay);
    }

    private void pollServerReward(long generation, String expectedSessionId,
                                  String expectedShowId) {
        if (!isActiveAd(generation, expectedSessionId, expectedShowId)) {
            return;
        }
        nativeApiClient.getSession(expectedSessionId,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.SessionStatus>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.SessionStatus status) {
                        if (!isActiveAd(generation, expectedSessionId, expectedShowId)) {
                            return;
                        }
                        try {
                            NativeRewardGate gate = new NativeRewardGate(
                                    expectedSessionId, expectedShowId);
                            NativeRewardGate.Decision decision = gate.evaluate(
                                    new NativeRewardGate.Evidence(
                                            status.getSessionId(),
                                            status.getRewardVerificationStatus(),
                                            status.getEntitlementStatus(),
                                            status.getProviderShowId()));
                            if (decision == NativeRewardGate.Decision.GRANT) {
                                completeFromServerEntitlement(
                                        generation, expectedSessionId, expectedShowId);
                            } else if (decision == NativeRewardGate.Decision.REJECT) {
                                failActiveUnlock(generation, "本次广告未通过服务端验奖");
                            } else {
                                scheduleNextPoll(
                                        generation, expectedSessionId, expectedShowId);
                            }
                        } catch (SecurityException mismatchedEvidence) {
                            failActiveUnlock(generation, "服务端奖励证明不匹配");
                        }
                    }

                    @Override
                    public void onFailure() {
                        scheduleNextPoll(generation, expectedSessionId, expectedShowId);
                    }
                });
    }

    private void completeFromServerEntitlement(long generation, String sessionId,
                                               String providerShowId) {
        if (!isActiveUnlock(generation)) {
            return;
        }
        IDJXDramaUnlockListener.CustomAdCallback callback = activeUnlockCallback;
        clearActiveUnlock();
        if (callback == null || destroyed) {
            return;
        }
        HashMap<String, Object> evidence = new HashMap<>();
        evidence.put("authority", "server_entitlement");
        if (sessionId != null) {
            evidence.put("sessionId", sessionId);
        }
        if (providerShowId != null) {
            evidence.put("providerShowId", providerShowId);
        }
        boolean serverEntitled = true;
        callback.onRewardVerify(new DJXRewardAdResult(serverEntitled, evidence));
        Toast.makeText(this, "服务端验奖通过，已解锁", Toast.LENGTH_SHORT).show();
    }

    private void failActiveUnlock(long generation, String message) {
        if (!isActiveUnlock(generation)) {
            return;
        }
        IDJXDramaUnlockListener.CustomAdCallback callback = activeUnlockCallback;
        clearActiveUnlock();
        if (callback != null && !destroyed) {
            callback.onError();
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        }
    }

    private void clearActiveUnlock() {
        handler.removeCallbacksAndMessages(null);
        if (takuRewardedAdController != null) {
            takuRewardedAdController.cancelActiveSession();
        }
        activeUnlockCallback = null;
        activeProtocol = null;
        activeProviderShowId = null;
        pollAttempt = 0;
        unlockGeneration = 0L;
    }

    private boolean isActiveUnlock(long generation) {
        return !destroyed && generation > 0L && generation == unlockGeneration
                && activeUnlockCallback != null;
    }

    private boolean isActiveAd(long generation, String expectedSessionId,
                               String expectedShowId) {
        return isActiveUnlock(generation) && activeProtocol != null
                && expectedSessionId != null
                && expectedSessionId.equals(activeProtocol.getSessionId())
                && expectedShowId != null
                && expectedShowId.equals(activeProviderShowId);
    }

    private IDJXAdListener createAdListener() {
        return new IDJXAdListener() {
            @Override
            public void onDJXAdRequestFail(int code, String message, Map<String, Object> extra) {
                Log.w(TAG, "DJX content ad request failed code=" + code);
            }
        };
    }

    private void failAndFinish(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        finish();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (widget != null) {
            widget.destroy();
            widget = null;
        }
        if (takuRewardedAdController != null) {
            takuRewardedAdController.destroy();
            takuRewardedAdController = null;
        }
        if (nativeApiClient != null) {
            nativeApiClient.close();
            nativeApiClient = null;
        }
        activeUnlockCallback = null;
        super.onDestroy();
    }
}
