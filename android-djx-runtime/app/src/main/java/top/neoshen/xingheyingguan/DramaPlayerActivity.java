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
import top.neoshen.xingheyingguan.ad.NativeEpisodeUnlockPolicy;
import top.neoshen.xingheyingguan.ad.NativePlayerGrant;
import top.neoshen.xingheyingguan.ad.NativeRewardGate;
import top.neoshen.xingheyingguan.ad.PlaybackEvidenceScope;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;
import top.neoshen.xingheyingguan.ad.VerifiedRewardEvidence;

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
    private String launchSessionRef;
    private String launchShowRef;
    private PlaybackEvidenceScope playbackEvidenceScope;
    private boolean targetPlaybackLogged;
    private boolean destroyed;
    private final NativeEpisodeUnlockPolicy unlockPolicy = new NativeEpisodeUnlockPolicy();
    private IDJXDramaUnlockListener.CustomAdCallback activeUnlockCallback;
    private AdSessionProtocol activeProtocol;
    private String activeProviderShowId;
    private String callbackShowSessionId;
    private String callbackShowId;
    private int pollAttempt;
    private long unlockGeneration;
    private int activeUnlockEpisode;

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
        int progress = getIntent().getIntExtra("progress", 0);
        if (dramaId <= 0L || initialEpisode <= 0) {
            finish();
            return;
        }
        try {
            launchSessionRef = readEvidenceReference("rewardSessionRef");
            launchShowRef = readEvidenceReference("rewardShowRef");
            if ("<none>".equals(launchSessionRef) != "<none>".equals(launchShowRef)) {
                throw new IllegalArgumentException("Incomplete launch evidence reference");
            }
            playbackEvidenceScope = new PlaybackEvidenceScope(
                    dramaId, initialEpisode, launchSessionRef, launchShowRef);
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
                    initializePlayer(progress);
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

    private void initializePlayer(int progress) {
        DJXDramaDetailConfig detailConfig = DJXDramaDetailConfig
                .obtain(DJXDramaUnlockAdMode.MODE_SPECIFIC,
                        NativeEpisodeUnlockPolicy.FREE_SET,
                        createUnlockListener(dramaId))
                .infiniteScrollEnabled(false)
                .hideCellularToast(true)
                .hideRewardDialog(true)
                .adListener(createAdListener())
                .listener(new IDJXDramaListener() {
                    @Override
                    public void onDJXClose() {
                        finish();
                    }

                    @Override
                    public void onDJXVideoPlay(Map<String, Object> extra) {
                        if (!targetPlaybackLogged
                                && playbackEvidenceScope.matchesTargetVideo(extra)) {
                            targetPlaybackLogged = true;
                            Log.i(TAG, playbackEvidenceScope.playingEvidence());
                        }
                    }

                    @Override
                    public void onDJXRequestFail(int code, String message,
                                                 Map<String, Object> extra) {
                        if (!targetPlaybackLogged
                                && playbackEvidenceScope.matchesTargetVideo(extra)) {
                            Log.w(TAG, playbackEvidenceScope.requestFailureEvidence(code));
                        }
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

    private String readEvidenceReference(String key) {
        String value = getIntent().getStringExtra(key);
        if (value == null) {
            return "<none>";
        }
        if (!value.matches("[0-9a-f]{12}")) {
            throw new IllegalArgumentException("Invalid launch evidence reference");
        }
        return value;
    }

    private IDJXDramaUnlockListener createUnlockListener(long fallbackDramaId) {
        return new IDJXDramaUnlockListener() {
            @Override
            public void unlockFlowStart(DJXDrama drama,
                                        IDJXDramaUnlockListener.UnlockCallback callback,
                                        Map<String, ? extends Object> extra) {
                long targetDramaId = drama == null || drama.id <= 0L ? fallbackDramaId : drama.id;
                if (callback != null) {
                    callback.onConfirm(new DJXDramaUnlockInfo(
                            targetDramaId,
                            NativeEpisodeUnlockPolicy.LOCK_SET,
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
                try {
                    unlockGeneration = unlockPolicy.begin(targetDramaId, targetEpisode);
                } catch (IllegalArgumentException invalidScope) {
                    callback.onError();
                    return;
                }
                activeUnlockEpisode = targetEpisode;
                activeUnlockCallback = callback;
                verifyExistingEntitlementOrStartAd(targetEpisode, unlockGeneration);
            }
        };
    }

    private void verifyExistingEntitlementOrStartAd(int targetEpisode, long generation) {
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> grantedEpisodes) {
                if (!isActiveUnlock(generation, targetEpisode)) {
                    return;
                }
                if (grantedEpisodes != null && grantedEpisodes.contains(targetEpisode)) {
                    completeWithVerifiedRewardProvenance(
                            generation, targetEpisode, null, null, grantedEpisodes);
                    return;
                }
                createServerAdSession(targetEpisode, generation);
            }

            @Override
            public void onFailure() {
                failActiveUnlock(generation, targetEpisode, "服务端权益校验失败");
            }
        });
    }

    private void createServerAdSession(int targetEpisode, long generation) {
        nativeApiClient.createAdSession(dramaId, targetEpisode,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.CreateResult>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.CreateResult result) {
                        if (!isActiveUnlock(generation, targetEpisode)) {
                            return;
                        }
                        if ("ALREADY_ENTITLED".equals(result.getOutcome())) {
                            verifyAuthoritativeEpisodeEntitlement(
                                    targetEpisode, generation, null, null);
                            return;
                        }
                        activeProtocol = result.getProtocol();
                        activeProviderShowId = null;
                        pollAttempt = 0;
                        if ("REUSED".equals(result.getOutcome())) {
                            scheduleNextPoll(
                                    generation, targetEpisode,
                                    activeProtocol.getSessionId(), null);
                            return;
                        }
                        if (!"CREATED".equals(result.getOutcome())) {
                            failActiveUnlock(
                                    generation, targetEpisode, "广告会话状态无效");
                            return;
                        }
                        try {
                            takuRewardedAdController.start(activeProtocol,
                                    DramaPlayerActivity.this::onTakuTelemetry);
                        } catch (Throwable startFailure) {
                            recordSynchronousTakuStartFailure(startFailure);
                        }
                    }

                    @Override
                    public void onFailure() {
                        failActiveUnlock(generation, targetEpisode, "广告会话创建失败");
                    }
                });
    }

    private void recordSynchronousTakuStartFailure(Throwable startFailure) {
        Log.w(TAG, "Taku synchronous startup failed: "
                + startFailure.getClass().getSimpleName());
        takuRewardedAdController.cancelActiveSession();
        try {
            TakuSessionStateMachine machine = new TakuSessionStateMachine(
                    activeProtocol, "native-" + activeProtocol.getSessionId());
            machine.initializing();
            onTakuTelemetry(machine.failed(null, null, null));
        } catch (Throwable telemetryFailure) {
            failActiveUnlock(unlockGeneration, activeUnlockEpisode, "广告暂不可用");
        }
    }

    private void onTakuTelemetry(TakuTelemetry telemetry) {
        if (destroyed || activeUnlockCallback == null || activeProtocol == null
                || !activeProtocol.getSessionId().equals(telemetry.getProtocol().getSessionId())) {
            return;
        }
        int targetEpisode = activeUnlockEpisode;
        long generation = unlockGeneration;
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        if (telemetry.getProviderShowId() != null) {
            if (activeProviderShowId == null) {
                activeProviderShowId = telemetry.getProviderShowId();
                try {
                    if (!reportCustomAdShown(new VerifiedRewardEvidence(
                            activeProtocol.getSessionId(), activeProviderShowId),
                            generation, targetEpisode)) {
                        return;
                    }
                } catch (IllegalArgumentException invalidShow) {
                    failActiveUnlock(generation, targetEpisode, "广告展示编号无效");
                    return;
                }
            } else if (!activeProviderShowId.equals(telemetry.getProviderShowId())) {
                failActiveUnlock(generation, targetEpisode, "广告展示编号不一致");
                return;
            }
        }
        nativeApiClient.recordTelemetry(telemetry,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.SessionStatus>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.SessionStatus ignored) {
                        afterTelemetryRecorded(telemetry, generation, targetEpisode);
                    }

                    @Override
                    public void onFailure() {
                        afterTelemetryRecorded(telemetry, generation, targetEpisode);
                    }
                });
    }

    private void afterTelemetryRecorded(TakuTelemetry telemetry, long generation,
                                        int targetEpisode) {
        if (!isActiveUnlock(generation, targetEpisode) || activeProtocol == null
                || !activeProtocol.getSessionId().equals(
                        telemetry.getProtocol().getSessionId())) {
            return;
        }
        if (telemetry.getState() == TakuNativeState.ERROR) {
            failActiveUnlock(generation, targetEpisode, "广告播放失败");
        } else if (telemetry.getState() == TakuNativeState.CLOSED) {
            scheduleNextPoll(
                    generation, targetEpisode, activeProtocol.getSessionId(), activeProviderShowId);
        }
    }

    private void scheduleNextPoll(long generation, int targetEpisode, String expectedSessionId,
                                  String expectedShowId) {
        if (!isActiveAd(generation, targetEpisode, expectedSessionId, expectedShowId)) {
            return;
        }
        if (pollAttempt >= STATUS_POLL_DELAYS_MS.length) {
            failActiveUnlock(generation, targetEpisode, "奖励仍在服务端验证中，请稍后重试");
            return;
        }
        long delay = STATUS_POLL_DELAYS_MS[pollAttempt++];
        handler.postDelayed(
                () -> pollServerReward(
                        generation, targetEpisode, expectedSessionId, expectedShowId), delay);
    }

    private void pollServerReward(long generation, int targetEpisode, String expectedSessionId,
                                  String expectedShowId) {
        if (!isActiveAd(generation, targetEpisode, expectedSessionId, expectedShowId)) {
            return;
        }
        nativeApiClient.getSession(expectedSessionId,
                new SkitNativeApiClient.Callback<SkitNativeApiClient.SessionStatus>() {
                    @Override
                    public void onSuccess(SkitNativeApiClient.SessionStatus status) {
                        if (!isActiveAd(
                                generation, targetEpisode, expectedSessionId, expectedShowId)) {
                            return;
                        }
                        Log.i(TAG, "TAKU_SERVER_STATUS rewardVerification="
                                + status.getRewardVerificationStatus()
                                + " entitlement=" + status.getEntitlementStatus()
                                + " hasShowId=" + (status.getProviderShowId() != null));
                        String serverShowId = expectedShowId;
                        if (serverShowId == null) {
                            serverShowId = status.getProviderShowId();
                            if (serverShowId == null) {
                                if ("SIGNED_VERIFIED".equals(
                                        status.getRewardVerificationStatus())
                                        || "GRANTED".equals(status.getEntitlementStatus())) {
                                    failActiveUnlock(
                                            generation, targetEpisode,
                                            "服务端奖励证明缺少展示编号");
                                } else if ("REJECTED".equals(
                                        status.getRewardVerificationStatus())
                                        || "VERIFY_TIMEOUT".equals(
                                        status.getRewardVerificationStatus())
                                        || "SECURITY_REVOKED".equals(
                                        status.getEntitlementStatus())) {
                                    failActiveUnlock(
                                            generation, targetEpisode,
                                            "本次广告未通过服务端验奖");
                                } else {
                                    scheduleNextPoll(
                                            generation, targetEpisode,
                                            expectedSessionId, null);
                                }
                                return;
                            }
                            activeProviderShowId = serverShowId;
                        }
                        try {
                            NativeRewardGate gate = new NativeRewardGate(
                                    expectedSessionId, serverShowId);
                            NativeRewardGate.Decision decision = gate.evaluate(
                                    new NativeRewardGate.Evidence(
                                            status.getSessionId(),
                                            status.getRewardVerificationStatus(),
                                            status.getEntitlementStatus(),
                                            status.getProviderShowId()));
                            if (decision == NativeRewardGate.Decision.GRANT) {
                                verifyAuthoritativeEpisodeEntitlement(
                                        targetEpisode, generation,
                                        expectedSessionId, serverShowId);
                            } else if (decision == NativeRewardGate.Decision.REJECT) {
                                failActiveUnlock(
                                        generation, targetEpisode, "本次广告未通过服务端验奖");
                            } else {
                                scheduleNextPoll(
                                        generation, targetEpisode,
                                        expectedSessionId, serverShowId);
                            }
                        } catch (SecurityException mismatchedEvidence) {
                            failActiveUnlock(
                                    generation, targetEpisode, "服务端奖励证明不匹配");
                        }
                    }

                    @Override
                    public void onFailure() {
                        scheduleNextPoll(
                                generation, targetEpisode, expectedSessionId, expectedShowId);
                    }
                });
    }

    private void verifyAuthoritativeEpisodeEntitlement(int targetEpisode, long generation,
                                                       String sessionId, String providerShowId) {
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        if ((sessionId == null) != (providerShowId == null)) {
            failActiveUnlock(generation, targetEpisode, "服务端奖励证明不完整");
            return;
        }
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> grantedEpisodes) {
                completeWithVerifiedRewardProvenance(
                        generation, targetEpisode, sessionId, providerShowId, grantedEpisodes);
            }

            @Override
            public void onFailure() {
                failActiveUnlock(generation, targetEpisode, "服务端权益复核失败");
            }
        });
    }

    private void completeWithVerifiedRewardProvenance(long generation, int targetEpisode,
                                                       String expectedSessionId,
                                                       String expectedProviderShowId,
                                                       List<Integer> grantedEpisodes) {
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        if ((expectedSessionId == null) != (expectedProviderShowId == null)
                || grantedEpisodes == null || !grantedEpisodes.contains(targetEpisode)) {
            failActiveUnlock(generation, targetEpisode, "目标剧集尚未获得服务端权益");
            return;
        }
        nativeApiClient.getVerifiedRewardProvenance(targetEpisode,
                new SkitNativeApiClient.Callback<VerifiedRewardEvidence>() {
                    @Override
                    public void onSuccess(VerifiedRewardEvidence evidence) {
                        if (!isActiveUnlock(generation, targetEpisode)) {
                            return;
                        }
                        if (evidence == null) {
                            failActiveUnlock(generation, targetEpisode,
                                    "服务端奖励凭证暂不可用");
                            return;
                        }
                        if (expectedSessionId != null
                                && !evidence.matches(expectedSessionId, expectedProviderShowId)) {
                            failActiveUnlock(generation, targetEpisode,
                                    "服务端奖励证明不匹配");
                            return;
                        }
                        completeFromServerEntitlement(
                                generation, targetEpisode, evidence, grantedEpisodes);
                    }

                    @Override
                    public void onFailure() {
                        failActiveUnlock(generation, targetEpisode, "服务端奖励凭证校验失败");
                    }
                });
    }

    /** Calls DJX onShow exactly once with a real server- or SDK-derived show identity. */
    private boolean reportCustomAdShown(VerifiedRewardEvidence evidence,
                                        long generation, int targetEpisode) {
        if (!isActiveUnlock(generation, targetEpisode) || evidence == null) {
            return false;
        }
        if ((callbackShowSessionId == null) != (callbackShowId == null)) {
            failActiveUnlock(generation, targetEpisode, "广告展示状态异常");
            return false;
        }
        if (callbackShowSessionId == null) {
            callbackShowSessionId = evidence.getSessionId();
            callbackShowId = evidence.getProviderShowId();
            try {
                activeUnlockCallback.onShow(evidence.getProviderShowId());
                return true;
            } catch (Throwable callbackFailure) {
                failActiveUnlock(generation, targetEpisode, "广告展示状态同步失败");
                return false;
            }
        }
        if (!evidence.matches(callbackShowSessionId, callbackShowId)) {
            failActiveUnlock(generation, targetEpisode, "广告展示编号不一致");
            return false;
        }
        return true;
    }

    private void completeFromServerEntitlement(long generation, int targetEpisode,
                                               VerifiedRewardEvidence proof,
                                               List<Integer> grantedEpisodes) {
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        if (proof == null || !matchesLaunchRewardEvidence(targetEpisode, proof)) {
            failActiveUnlock(generation, targetEpisode, "服务端奖励证明不匹配");
            return;
        }
        if (grantedEpisodes == null || !grantedEpisodes.contains(targetEpisode)) {
            failActiveUnlock(generation, targetEpisode, "目标剧集尚未获得服务端权益");
            return;
        }
        if (!reportCustomAdShown(proof, generation, targetEpisode)) {
            return;
        }
        if (!unlockPolicy.consumeIfEntitled(
                generation, dramaId, targetEpisode, grantedEpisodes)) {
            failActiveUnlock(generation, targetEpisode, "目标剧集尚未获得服务端权益");
            return;
        }
        IDJXDramaUnlockListener.CustomAdCallback callback = activeUnlockCallback;
        clearActiveUnlock();
        if (callback == null || destroyed) {
            return;
        }
        HashMap<String, Object> rewardPayload = new HashMap<>();
        rewardPayload.put("authority", "signed_reward_provenance");
        rewardPayload.put("dramaId", dramaId);
        rewardPayload.put("episode", targetEpisode);
        rewardPayload.put("sessionId", proof.getSessionId());
        rewardPayload.put("providerShowId", proof.getProviderShowId());
        callback.onRewardVerify(new DJXRewardAdResult(true, rewardPayload));
        Toast.makeText(this, "服务端验奖通过，已解锁", Toast.LENGTH_SHORT).show();
    }

    /** The H5-provided safe references bind only the episode that launched this player. */
    private boolean matchesLaunchRewardEvidence(int targetEpisode,
                                                VerifiedRewardEvidence evidence) {
        return targetEpisode != initialEpisode || evidence.matches(playbackEvidenceScope);
    }

    private void failActiveUnlock(long generation, int targetEpisode, String message) {
        if (!isActiveUnlock(generation, targetEpisode)) {
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
        unlockPolicy.cancel(unlockGeneration);
        handler.removeCallbacksAndMessages(null);
        if (takuRewardedAdController != null) {
            takuRewardedAdController.cancelActiveSession();
        }
        activeUnlockCallback = null;
        activeProtocol = null;
        activeProviderShowId = null;
        callbackShowSessionId = null;
        callbackShowId = null;
        pollAttempt = 0;
        unlockGeneration = 0L;
        activeUnlockEpisode = 0;
    }

    private boolean isActiveUnlock(long generation, int targetEpisode) {
        return !destroyed && generation > 0L && generation == unlockGeneration
                && targetEpisode == activeUnlockEpisode
                && activeUnlockCallback != null
                && unlockPolicy.isActive(generation, dramaId, targetEpisode);
    }

    private boolean isActiveAd(long generation, int targetEpisode, String expectedSessionId,
                               String expectedShowId) {
        return isActiveUnlock(generation, targetEpisode) && activeProtocol != null
                && expectedSessionId != null
                && expectedSessionId.equals(activeProtocol.getSessionId())
                && (expectedShowId == null
                ? activeProviderShowId == null
                : expectedShowId.equals(activeProviderShowId));
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
        unlockPolicy.cancel(unlockGeneration);
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
        callbackShowSessionId = null;
        callbackShowId = null;
        super.onDestroy();
    }
}
