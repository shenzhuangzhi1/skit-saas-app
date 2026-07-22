package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.app.Fragment;
import android.graphics.Color;
import android.os.Build;
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

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.NativeAdSessionRecoveryPolicy;
import top.neoshen.xingheyingguan.ad.NativeEpisodeUnlockPolicy;
import top.neoshen.xingheyingguan.ad.NativePlayerCallbackEpoch;
import top.neoshen.xingheyingguan.ad.NativePlayerGrant;
import top.neoshen.xingheyingguan.ad.NativeRewardGate;
import top.neoshen.xingheyingguan.ad.NativeSdkUnlockResumePolicy;
import top.neoshen.xingheyingguan.ad.NativeSdkUnlockTerminalEvidence;
import top.neoshen.xingheyingguan.ad.PlaybackEvidenceScope;
import top.neoshen.xingheyingguan.ad.TakuFailureReason;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;
import top.neoshen.xingheyingguan.ad.VerifiedRewardEvidence;

/** DJX content player whose unlock authority is the server entitlement endpoint. */
public class DramaPlayerActivity extends Activity {
    private static final String TAG = "SkitDramaPlayer";
    private static final long[] STATUS_POLL_DELAYS_MS = {500L, 1_000L, 2_000L, 3_000L, 3_000L};
    private static final long[] LAUNCH_EVIDENCE_POLL_DELAYS_MS = {
            500L, 1_000L, 2_000L, 3_000L, 3_000L};
    private static final long SDK_UNLOCK_SERVER_FIRST_TIMEOUT_MS = 15_000L;
    private static final long SDK_UNLOCK_TERMINAL_FIRST_TIMEOUT_MS = 180_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Handler sdkUnlockHandler = new Handler(Looper.getMainLooper());
    private IDJXWidget widget;
    private TakuRewardedAdController takuRewardedAdController;
    private SkitNativeApiClient nativeApiClient;
    private NativePlayerGrant playerGrant;
    private FrameLayout root;
    private FrameLayout playerContainer;
    private Fragment playerFragment;
    private View gateOverlay;
    private long dramaId;
    private int initialEpisode;
    private String launchSessionRef;
    private String launchShowRef;
    private PlaybackEvidenceScope playbackEvidenceScope;
    private boolean targetPlaybackLogged;
    private boolean destroyed;
    private final NativeEpisodeUnlockPolicy unlockPolicy = new NativeEpisodeUnlockPolicy();
    private final NativeAdSessionRecoveryPolicy adSessionRecoveryPolicy =
            new NativeAdSessionRecoveryPolicy();
    private final NativePlayerCallbackEpoch playerCallbackEpoch =
            new NativePlayerCallbackEpoch();
    private final NativeSdkUnlockResumePolicy sdkUnlockResumePolicy =
            new NativeSdkUnlockResumePolicy();
    private IDJXDramaUnlockListener.CustomAdCallback activeUnlockCallback;
    private long activeUnlockCallbackEpoch;
    private AdSessionProtocol activeProtocol;
    private String activeSessionId;
    private String activeProviderShowId;
    private boolean activeSessionPollOnly;
    private String callbackShowSessionId;
    private String callbackShowId;
    private int pollAttempt;
    private int launchEvidencePollAttempt;
    private long unlockGeneration;
    private int activeUnlockEpisode;
    private List<Integer> grantedEpisodes = Collections.emptyList();
    private boolean activePageGateUnlock;
    private int activePageGateProgress;
    private int lastAuthorizedEpisode;
    private boolean fragmentTransactionsAllowed;
    private int pendingResumeEpisode;
    private int pendingResumeProgress;
    private int lastPlayingEpisode;
    private boolean terminatingSdkUnlock;
    private Runnable sdkUnlockRendezvousTimeout;

    /** DJX may synchronously finish its host immediately after its terminal callback. */
    @Override
    public void finish() {
        if (!destroyed && shouldDeferHostExitForUnlock()) {
            Log.i(TAG, "suppressed terminal finish while server-authorized SDK resume is pending");
            return;
        }
        super.finish();
    }

    private boolean shouldDeferHostExitForUnlock() {
        return hasActiveUnlock() || sdkUnlockResumePolicy.hasOutstandingResumeScope();
    }

    /** Our own fatal paths must never be hidden by the narrow SDK terminal-finish guard. */
    private void finishHostActivity() {
        cancelSdkUnlockRendezvousTimeout();
        sdkUnlockResumePolicy.cancel();
        super.finish();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "creating protected player activity");
        root = new FrameLayout(this);
        root.setId(View.generateViewId());
        playerContainer = new FrameLayout(this);
        playerContainer.setId(View.generateViewId());
        root.addView(playerContainer, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        if (!DJXSdk.isStartSuccess()) {
            Log.w(TAG, "finishing player activity because DJX is not started");
            finishHostActivity();
            return;
        }
        dramaId = getIntent().getLongExtra("dramaId", 0L);
        initialEpisode = getIntent().getIntExtra("episode", 1);
        int progress = getIntent().getIntExtra("progress", 0);
        if (dramaId <= 0L || initialEpisode <= 0) {
            Log.w(TAG, "finishing player activity because launch scope is invalid");
            finishHostActivity();
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
            Log.w(TAG, "finishing player activity because launch grant is invalid",
                    invalidGrant);
            failAndFinish("播放器权限无效，请返回重试");
            return;
        }

        takuRewardedAdController = new TakuRewardedAdController(this);
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> serverEntitlements) {
                if (destroyed) {
                    return;
                }
                updateGrantedEpisodes(serverEntitlements);
                if (enforceEpisodeAccess(initialEpisode, progress)) {
                    Log.i(TAG, "native entitlement check passed; initializing DJX player");
                    initializePlayer(initialEpisode, progress);
                }
            }

            @Override
            public void onFailure() {
                if (!destroyed) {
                    Log.w(TAG, "native entitlement check failed; returning to H5");
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

    private void initializePlayer(int episode, int progress) {
        if (destroyed || isFinishing()) {
            return;
        }
        if (!canAttachPlayer()) {
            pendingResumeEpisode = episode;
            pendingResumeProgress = Math.max(0, progress);
            return;
        }
        pendingResumeEpisode = 0;
        pendingResumeProgress = 0;
        long callbackEpoch = playerCallbackEpoch.next();
        removePlayerFragment();
        destroyWidget();
        hideGateOverlay();
        Log.i(TAG, "creating DJX detail widget");
        DJXDramaDetailConfig detailConfig = DJXDramaDetailConfig
                .obtain(DJXDramaUnlockAdMode.MODE_SPECIFIC,
                        NativeEpisodeUnlockPolicy.FREE_SET,
                        createUnlockListener(dramaId, callbackEpoch))
                .infiniteScrollEnabled(false)
                .hideCellularToast(true)
                .hideRewardDialog(true)
                .adListener(createAdListener())
                .listener(new IDJXDramaListener() {
                    @Override
                    public void onDJXClose() {
                        if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                            Log.d(TAG, "Ignoring stale DJX close callback");
                            return;
                        }
                        Log.i(TAG, "DJX detail widget closed");
                        if (shouldDeferHostExitForUnlock()) {
                            Log.i(TAG, "deferred DJX close while unlock is active");
                            return;
                        }
                        finishHostActivity();
                    }

                    @Override
                    public void onDJXPageChange(int position, Map<String, Object> extra) {
                        if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                            return;
                        }
                        enforceEpisodeAccess(extra, 0);
                    }

                    @Override
                    public void onDJXVideoPlay(Map<String, Object> extra) {
                        if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                            return;
                        }
                        int playingEpisode = episodeFromEvidence(extra);
                        if (playingEpisode <= 0
                                || !enforceEpisodeAccess(playingEpisode, 0)) {
                            return;
                        }
                        if (lastPlayingEpisode != playingEpisode) {
                            lastPlayingEpisode = playingEpisode;
                            Log.i(TAG, "PLAYER_EPISODE_PLAYING dramaId=" + dramaId
                                    + " episode=" + playingEpisode);
                        }
                        if (!targetPlaybackLogged
                                && playbackEvidenceScope.matchesTargetVideo(extra)) {
                            targetPlaybackLogged = true;
                            Log.i(TAG, playbackEvidenceScope.playingEvidence());
                        }
                    }

                    @Override
                    public void onDJXRequestFail(int code, String message,
                                                 Map<String, Object> extra) {
                        if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                            return;
                        }
                        if (!targetPlaybackLogged
                                && playbackEvidenceScope.matchesTargetVideo(extra)) {
                            Log.w(TAG, playbackEvidenceScope.requestFailureEvidence(code));
                        }
                    }
                });

        DJXWidgetDramaDetailParams params = DJXWidgetDramaDetailParams
                .obtain(dramaId, episode, detailConfig)
                .currentDuration(progress);
        widget = DJXSdk.factory().createDramaDetail(params);
        playerFragment = widget.getFragment2();
        getFragmentManager().beginTransaction()
                .replace(playerContainer.getId(), playerFragment,
                        String.valueOf(playerContainer.getId()))
                .commitNow();
        if (sdkUnlockResumePolicy.consumePendingResumeForAttachment(episode)) {
            cancelSdkUnlockRendezvousTimeout();
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private boolean canAttachPlayer() {
        return fragmentTransactionsAllowed
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || !getFragmentManager().isStateSaved());
    }

    private boolean enforceEpisodeAccess(Map<String, Object> evidence, int progress) {
        int episode = episodeFromEvidence(evidence);
        if (episode <= 0) {
            Log.w(TAG, "EPISODE_GATE invalid DJX playback evidence");
            suspendPlayerForGate();
            failAndFinish("剧集校验失败，请返回重试");
            return false;
        }
        return enforceEpisodeAccess(episode, progress);
    }

    private boolean enforceEpisodeAccess(int episode, int progress) {
        if (terminatingSdkUnlock) {
            return false;
        }
        NativeEpisodeUnlockPolicy.AccessRequest access;
        try {
            access = unlockPolicy.request(dramaId, episode, grantedEpisodes);
        } catch (IllegalArgumentException invalidScope) {
            failAndFinish("剧集校验失败，请返回重试");
            return false;
        }
        if (access.getDecision() == NativeEpisodeUnlockPolicy.Decision.ALLOW) {
            lastAuthorizedEpisode = episode;
            return true;
        }
        if (access.getDecision() == NativeEpisodeUnlockPolicy.Decision.WAIT) {
            if (activeUnlockCallback != null && !activePageGateUnlock) {
                showGateOverlay();
                return false;
            }
            suspendPlayerForGate();
            return false;
        }
        if (access.getDecision() == NativeEpisodeUnlockPolicy.Decision.CONFLICT) {
            Log.w(TAG, "EPISODE_GATE conflicting page while an unlock is active");
            suspendPlayerForGate();
            long activeGeneration = unlockGeneration;
            int activeEpisode = activeUnlockEpisode;
            failActiveUnlock(activeGeneration, activeEpisode, "剧集切换状态异常，请重试");
            finishHostActivity();
            return false;
        }

        unlockGeneration = access.getGeneration();
        adSessionRecoveryPolicy.begin(unlockGeneration);
        activeUnlockEpisode = episode;
        activePageGateProgress = Math.max(0, progress);
        activePageGateUnlock = true;
        Log.i(TAG, "EPISODE_GATE REQUIRE_AD dramaId=" + dramaId
                + " episode=" + episode + " generation=" + unlockGeneration);
        suspendPlayerForGate();
        verifyExistingEntitlementOrStartAd(episode, unlockGeneration);
        return false;
    }

    private int episodeFromEvidence(Map<String, ? extends Object> evidence) {
        if (evidence == null || !exactLong(evidence.get("drama_id"), dramaId)) {
            return 0;
        }
        Object value = evidence.get("index");
        if (!(value instanceof Number)) {
            return 0;
        }
        Number number = (Number) value;
        long episode = number.longValue();
        double doubleValue = number.doubleValue();
        if (!Double.isFinite(doubleValue) || doubleValue != (double) episode
                || episode <= 0L || episode > Integer.MAX_VALUE) {
            return 0;
        }
        return (int) episode;
    }

    private static boolean exactLong(Object value, long expected) {
        if (!(value instanceof Number)) {
            return false;
        }
        Number number = (Number) value;
        long candidate = number.longValue();
        double doubleValue = number.doubleValue();
        return Double.isFinite(doubleValue)
                && doubleValue == (double) candidate
                && candidate == expected;
    }

    private void updateGrantedEpisodes(List<Integer> serverEntitlements) {
        ArrayList<Integer> validated = new ArrayList<>();
        if (serverEntitlements != null) {
            for (Integer episode : serverEntitlements) {
                if (episode != null && episode > 0 && !validated.contains(episode)) {
                    validated.add(episode);
                }
            }
        }
        grantedEpisodes = Collections.unmodifiableList(validated);
    }

    private void suspendPlayerForGate() {
        pendingResumeEpisode = 0;
        pendingResumeProgress = 0;
        playerCallbackEpoch.invalidate();
        showGateOverlay();
        removePlayerFragment();
        destroyWidget();
    }

    private void showGateOverlay() {
        if (root == null) {
            return;
        }
        if (gateOverlay == null) {
            gateOverlay = new View(this);
            gateOverlay.setBackgroundColor(Color.BLACK);
            gateOverlay.setClickable(true);
            gateOverlay.setFocusable(true);
            root.addView(gateOverlay, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT));
        }
        gateOverlay.bringToFront();
    }

    private void hideGateOverlay() {
        if (root != null && gateOverlay != null) {
            root.removeView(gateOverlay);
            gateOverlay = null;
        }
    }

    private void removePlayerFragment() {
        Fragment fragment = playerFragment;
        playerFragment = null;
        if (fragment != null && fragment.isAdded()) {
            getFragmentManager().beginTransaction()
                    .remove(fragment)
                    .commitNowAllowingStateLoss();
        }
    }

    private void destroyWidget() {
        if (widget != null) {
            widget.destroy();
            widget = null;
        }
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

    private IDJXDramaUnlockListener createUnlockListener(long fallbackDramaId,
                                                          long callbackEpoch) {
        return new IDJXDramaUnlockListener() {
            private long pendingDramaId;
            private int pendingEpisode;

            @Override
            public void unlockFlowStart(DJXDrama drama,
                                        IDJXDramaUnlockListener.UnlockCallback callback,
                                        Map<String, ? extends Object> extra) {
                if (terminatingSdkUnlock) {
                    return;
                }
                if (sdkUnlockResumePolicy.hasOutstandingResumeScope()) {
                    return;
                }
                if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                    return;
                }
                capturePendingSdkUnlockScope(drama, extra);
                long targetDramaId = pendingDramaId > 0L ? pendingDramaId : fallbackDramaId;
                if (callback != null) {
                    callback.onConfirm(new DJXDramaUnlockInfo(
                            targetDramaId,
                            NativeEpisodeUnlockPolicy.LOCK_SET,
                            DJXDramaUnlockMethod.METHOD_AD,
                            false,
                            null,
                            false,
                            DJXUnlockModeType.UNLOCKTYPE_DEFAULT));
                }
            }

            @Override
            public void unlockFlowEnd(DJXDrama drama,
                                      IDJXDramaUnlockListener.UnlockErrorStatus status,
                                      Map<String, ? extends Object> extra) {
                if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                    return;
                }
                long completedDramaId = drama == null
                        ? 0L : (drama.id > 0L ? drama.id : -1L);
                int completedEpisode = NativeSdkUnlockTerminalEvidence.reportedEpisode(
                        extra, dramaId);
                clearPendingSdkUnlockScope();
                dispatchSdkUnlockTerminal(
                        callbackEpoch, completedDramaId, completedEpisode,
                        String.valueOf(status));
            }

            @Override
            public void showCustomAd(DJXDrama drama,
                                     IDJXDramaUnlockListener.CustomAdCallback callback) {
                if (terminatingSdkUnlock) {
                    return;
                }
                if (sdkUnlockResumePolicy.hasOutstandingResumeScope()) {
                    if (callback != null) {
                        callback.onError();
                    }
                    return;
                }
                if (!playerCallbackEpoch.isCurrent(callbackEpoch)) {
                    if (callback != null) {
                        callback.onError();
                    }
                    return;
                }
                if (callback == null || hasActiveUnlock() || destroyed) {
                    if (callback != null) {
                        callback.onError();
                    }
                    return;
                }
                long targetDramaId = pendingDramaId;
                int targetEpisode = pendingEpisode;
                clearPendingSdkUnlockScope();
                if (drama == null || drama.id <= 0L || drama.id != targetDramaId
                        || targetDramaId != dramaId || targetEpisode <= 0) {
                    callback.onError();
                    return;
                }
                try {
                    unlockGeneration = unlockPolicy.begin(targetDramaId, targetEpisode);
                    adSessionRecoveryPolicy.begin(unlockGeneration);
                    sdkUnlockResumePolicy.begin(
                            callbackEpoch, targetDramaId, targetEpisode);
                    Log.i(TAG, "SDK_UNLOCK_SCOPE_BEGIN dramaId=" + targetDramaId
                            + " episode=" + targetEpisode
                            + " callbackEpoch=" + callbackEpoch);
                } catch (IllegalArgumentException | IllegalStateException invalidScope) {
                    sdkUnlockResumePolicy.cancel();
                    adSessionRecoveryPolicy.cancel(unlockGeneration);
                    unlockPolicy.cancel(unlockGeneration);
                    callback.onError();
                    return;
                }
                activeUnlockEpisode = targetEpisode;
                activeUnlockCallback = callback;
                activeUnlockCallbackEpoch = callbackEpoch;
                activePageGateUnlock = false;
                activePageGateProgress = 0;
                showGateOverlay();
                verifyExistingEntitlementOrStartAd(targetEpisode, unlockGeneration);
            }

            private void capturePendingSdkUnlockScope(
                    DJXDrama drama, Map<String, ? extends Object> extra) {
                clearPendingSdkUnlockScope();
                int targetEpisode = episodeFromEvidence(extra);
                if (drama == null || drama.id <= 0L || drama.id != dramaId
                        || targetEpisode <= 0) {
                    Log.w(TAG, "EPISODE_GATE invalid DJX unlock-start evidence");
                    return;
                }
                pendingDramaId = dramaId;
                pendingEpisode = targetEpisode;
            }

            private void clearPendingSdkUnlockScope() {
                pendingDramaId = 0L;
                pendingEpisode = 0;
            }
        };
    }

    /** DJX does not guarantee which thread delivers unlockFlowEnd. */
    private void dispatchSdkUnlockTerminal(long callbackEpoch, long completedDramaId,
                                           int completedEpisode, String terminalStatus) {
        Runnable terminal = () -> handleSdkUnlockTerminal(
                callbackEpoch, completedDramaId, completedEpisode, terminalStatus);
        if (Looper.myLooper() == Looper.getMainLooper()) {
            terminal.run();
        } else if (!sdkUnlockHandler.post(terminal)) {
            Log.w(TAG, "failed to dispatch DJX terminal callback to main thread");
            sdkUnlockResumePolicy.cancel();
        }
    }

    private void handleSdkUnlockTerminal(long callbackEpoch, long completedDramaId,
                                         int completedEpisode, String terminalStatus) {
        if (destroyed || !playerCallbackEpoch.isCurrent(callbackEpoch)) {
            return;
        }
        boolean hadSdkOwnedScope = sdkUnlockResumePolicy.hasOutstandingResumeScope();
        int resumeEpisode = sdkUnlockResumePolicy.observeTerminal(
                callbackEpoch, completedDramaId, completedEpisode);
        Log.i(TAG, "server-gated unlock flow ended status=" + terminalStatus
                + " reportedDramaId=" + completedDramaId
                + " reportedEpisode=" + completedEpisode
                + " resumeEpisode=" + resumeEpisode);
        if (!hadSdkOwnedScope) {
            Log.i(TAG, "ignored DJX terminal callback without an SDK-owned unlock scope");
            return;
        }
        if (resumeEpisode == NativeSdkUnlockResumePolicy.REJECTED_EPISODE) {
            cancelSdkUnlockRendezvousTimeout();
            if (hasActiveUnlock()) {
                failActiveUnlock(
                        unlockGeneration, activeUnlockEpisode,
                        "剧集解锁回调校验失败，请重试");
            } else {
                finishHostActivity();
            }
            return;
        }
        if (resumeEpisode > 0) {
            queueSdkUnlockResume(callbackEpoch, resumeEpisode);
        } else if (sdkUnlockResumePolicy.isWaitingForCounterpart(
                callbackEpoch, activeUnlockEpisode)) {
            scheduleSdkUnlockRendezvousTimeout(
                    callbackEpoch, activeUnlockEpisode, activeUnlockCallback);
        }
    }

    private void verifyExistingEntitlementOrStartAd(int targetEpisode, long generation) {
        nativeApiClient.getEntitlements(new SkitNativeApiClient.Callback<List<Integer>>() {
            @Override
            public void onSuccess(List<Integer> serverEntitlements) {
                if (!isActiveUnlock(generation, targetEpisode)) {
                    return;
                }
                updateGrantedEpisodes(serverEntitlements);
                if (grantedEpisodes.contains(targetEpisode)) {
                    completeWithVerifiedRewardProvenance(
                            generation, targetEpisode, null, null, serverEntitlements);
                    return;
                }
                if (hasLaunchRewardEvidenceFor(targetEpisode)) {
                    scheduleLaunchEvidenceEntitlementPoll(targetEpisode, generation);
                    return;
                }
                createServerAdSession(targetEpisode, generation);
            }

            @Override
            public void onFailure() {
                if (hasLaunchRewardEvidenceFor(targetEpisode)) {
                    scheduleLaunchEvidenceEntitlementPoll(targetEpisode, generation);
                    return;
                }
                failActiveUnlock(generation, targetEpisode, "服务端权益校验失败");
            }
        });
    }

    /** A verified H5 reward may reach the native player just before the entitlement read catches up. */
    private boolean hasLaunchRewardEvidenceFor(int targetEpisode) {
        return targetEpisode == initialEpisode
                && !"<none>".equals(launchSessionRef)
                && !"<none>".equals(launchShowRef);
    }

    /** Never trade a just-earned H5 reward for a second native Taku request. */
    private void scheduleLaunchEvidenceEntitlementPoll(int targetEpisode, long generation) {
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        if (launchEvidencePollAttempt >= LAUNCH_EVIDENCE_POLL_DELAYS_MS.length) {
            failActiveUnlock(generation, targetEpisode, "奖励确认中，可稍后返回查看");
            return;
        }
        long delay = LAUNCH_EVIDENCE_POLL_DELAYS_MS[launchEvidencePollAttempt++];
        handler.postDelayed(
                () -> verifyExistingEntitlementOrStartAd(targetEpisode, generation), delay);
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
                        activeSessionId = result.getSessionId();
                        activeProviderShowId = null;
                        activeSessionPollOnly = false;
                        pollAttempt = 0;
                        if ("REUSED".equals(result.getOutcome())
                                || "VERIFYING".equals(result.getOutcome())) {
                            activeSessionPollOnly = true;
                            scheduleNextPoll(
                                    generation, targetEpisode,
                                    activeSessionId, null);
                            return;
                        }
                        if (!"CREATED".equals(result.getOutcome())) {
                            failActiveUnlock(
                                    generation, targetEpisode, "广告会话状态无效");
                            return;
                        }
                        if (activeProtocol == null) {
                            failActiveUnlock(
                                    generation, targetEpisode, "广告会话协议无效");
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
        if (destroyed || !hasActiveUnlock() || activeProtocol == null
                || !activeProtocol.getSessionId().equals(telemetry.getProtocol().getSessionId())) {
            return;
        }
        int targetEpisode = activeUnlockEpisode;
        long generation = unlockGeneration;
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        boolean unrewardedClose = telemetry.getState() == TakuNativeState.CLOSED
                && !telemetry.isClientRewardObserved();
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
        if (unrewardedClose) {
            handler.post(() -> failActiveUnlock(
                    generation, targetEpisode, "广告未完整观看，请重新观看"));
        }
    }

    private void afterTelemetryRecorded(TakuTelemetry telemetry, long generation,
                                        int targetEpisode) {
        if (!isActiveUnlock(generation, targetEpisode) || activeProtocol == null
                || !activeProtocol.getSessionId().equals(
                        telemetry.getProtocol().getSessionId())) {
            return;
        }
        if (telemetry.getState() == TakuNativeState.ERROR) {
            failActiveUnlock(
                    generation,
                    targetEpisode,
                    telemetry.getFailureReason() == TakuFailureReason.NO_FILL
                            ? "当前广告库存不足，请稍后再试"
                            : "广告播放失败");
        } else if (telemetry.getState() == TakuNativeState.CLOSED
                && telemetry.isClientRewardObserved()) {
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
                                + " lifecycle=" + status.getClientLifecycleStatus()
                                + " entitlement=" + status.getEntitlementStatus()
                                + " hasShowId=" + (status.getProviderShowId() != null));
                        String serverShowId = expectedShowId;
                        if (serverShowId == null) {
                            serverShowId = status.getProviderShowId();
                            if (serverShowId == null) {
                                if (retryExpiredPollOnlySession(
                                        generation, targetEpisode,
                                        expectedSessionId, status)) {
                                    return;
                                }
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

    private boolean retryExpiredPollOnlySession(
            long generation, int targetEpisode, String expectedSessionId,
            SkitNativeApiClient.SessionStatus status) {
        if ((callbackShowSessionId != null || callbackShowId != null)
                || !adSessionRecoveryPolicy.consumeIfRecoverable(
                generation, activeSessionPollOnly,
                expectedSessionId, status.getSessionId(),
                status.getClientLifecycleStatus(),
                status.getRewardVerificationStatus(), status.getProviderShowId())) {
            return false;
        }
        Log.i(TAG, "Replacing expired poll-only ad session within the active unlock flow");
        activeProtocol = null;
        activeSessionId = null;
        activeProviderShowId = null;
        activeSessionPollOnly = false;
        pollAttempt = 0;
        createServerAdSession(targetEpisode, generation);
        return true;
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
            if (activeUnlockCallback == null) {
                return true;
            }
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
        updateGrantedEpisodes(grantedEpisodes);
        IDJXDramaUnlockListener.CustomAdCallback callback = activeUnlockCallback;
        long callbackEpoch = activeUnlockCallbackEpoch;
        boolean pageGateUnlock = activePageGateUnlock;
        int resumeProgress = activePageGateProgress;
        Log.i(TAG, "UNLOCK_COMPLETION_OWNER sdk=" + (callback != null)
                + " pageGate=" + pageGateUnlock
                + " episode=" + targetEpisode);
        HashMap<String, Object> rewardPayload = new HashMap<>();
        rewardPayload.put("authority", "signed_reward_provenance");
        rewardPayload.put("dramaId", dramaId);
        rewardPayload.put("episode", targetEpisode);
        rewardPayload.put("sessionId", proof.getSessionId());
        rewardPayload.put("providerShowId", proof.getProviderShowId());

        // Clear broad ad/poll callbacks before arming the dedicated SDK rendezvous queue.
        clearActiveUnlock();
        if (destroyed) {
            return;
        }
        if (callback != null) {
            int resumeAfterAuthorization = sdkUnlockResumePolicy.authorizeFromServer(
                    callbackEpoch, dramaId, grantedEpisodes);
            if (resumeAfterAuthorization == NativeSdkUnlockResumePolicy.REJECTED_EPISODE) {
                failDetachedSdkUnlock(
                        callback, "服务端授权与剧集解锁回调不匹配");
                return;
            }
            if (resumeAfterAuthorization > 0) {
                queueSdkUnlockResume(callbackEpoch, resumeAfterAuthorization);
            } else if (sdkUnlockResumePolicy.isWaitingForCounterpart(
                    callbackEpoch, targetEpisode)) {
                scheduleSdkUnlockRendezvousTimeout(
                        callbackEpoch, targetEpisode, callback);
            }
            try {
                callback.onRewardVerify(new DJXRewardAdResult(true, rewardPayload));
            } catch (Throwable callbackFailure) {
                Log.w(TAG, "DJX reward verification callback failed", callbackFailure);
                if (!sdkUnlockResumePolicy.isPendingResume(
                        callbackEpoch, targetEpisode)
                        && !sdkUnlockResumePolicy.isWaitingForCounterpart(
                        callbackEpoch, targetEpisode)) {
                    failDetachedSdkUnlock(callback, "剧集解锁确认失败，请重试");
                    return;
                }
            }
        }
        if (pageGateUnlock) {
            lastAuthorizedEpisode = targetEpisode;
            initializePlayer(targetEpisode, resumeProgress);
        }
        Toast.makeText(this, "服务端验奖通过，已解锁", Toast.LENGTH_SHORT).show();
    }

    /** The H5-provided safe references bind only the episode that launched this player. */
    private boolean matchesLaunchRewardEvidence(int targetEpisode,
                                                VerifiedRewardEvidence evidence) {
        return targetEpisode != initialEpisode || evidence.matches(playbackEvidenceScope);
    }

    private void queueSdkUnlockResume(long callbackEpoch, int episode) {
        cancelSdkUnlockRendezvousTimeout();
        if (!sdkUnlockHandler.post(
                () -> resumeAfterSdkUnlock(callbackEpoch, episode))) {
            Log.w(TAG, "failed to queue server-authorized SDK resume");
            finishHostActivity();
        }
    }

    /** Starts only after one side arrives, so a legitimately long rewarded ad is never timed out. */
    private void scheduleSdkUnlockRendezvousTimeout(
            long callbackEpoch, int episode,
            IDJXDramaUnlockListener.CustomAdCallback callback) {
        if (episode <= 0 || !sdkUnlockResumePolicy.isWaitingForCounterpart(
                callbackEpoch, episode)) {
            return;
        }
        if (sdkUnlockRendezvousTimeout != null) {
            return;
        }
        long timeoutMillis = hasActiveUnlock()
                ? SDK_UNLOCK_TERMINAL_FIRST_TIMEOUT_MS
                : SDK_UNLOCK_SERVER_FIRST_TIMEOUT_MS;
        Runnable timeout = new Runnable() {
            @Override
            public void run() {
                if (sdkUnlockRendezvousTimeout != this) {
                    return;
                }
                sdkUnlockRendezvousTimeout = null;
                if (destroyed || !sdkUnlockResumePolicy.isWaitingForCounterpart(
                        callbackEpoch, episode)) {
                    return;
                }
                Log.w(TAG, "SDK unlock rendezvous timed out dramaId="
                        + dramaId + " episode=" + episode);
                if (hasActiveUnlock()) {
                    failActiveUnlock(
                            unlockGeneration, activeUnlockEpisode,
                            "剧集解锁确认超时，请重试");
                } else {
                    failDetachedSdkUnlock(callback, "剧集解锁确认超时，请重试");
                }
            }
        };
        sdkUnlockRendezvousTimeout = timeout;
        if (!sdkUnlockHandler.postDelayed(timeout, timeoutMillis)) {
            timeout.run();
        }
    }

    private void cancelSdkUnlockRendezvousTimeout() {
        Runnable timeout = sdkUnlockRendezvousTimeout;
        sdkUnlockRendezvousTimeout = null;
        if (timeout != null) {
            sdkUnlockHandler.removeCallbacks(timeout);
        }
    }

    private void failDetachedSdkUnlock(
            IDJXDramaUnlockListener.CustomAdCallback callback, String message) {
        cancelSdkUnlockRendezvousTimeout();
        sdkUnlockResumePolicy.cancel();
        if (destroyed) {
            return;
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        terminatingSdkUnlock = true;
        try {
            if (callback != null) {
                callback.onError();
            }
        } catch (Throwable callbackFailure) {
            Log.w(TAG, "DJX detached unlock error callback failed", callbackFailure);
        } finally {
            finishHostActivity();
        }
    }

    private void failActiveUnlock(long generation, int targetEpisode, String message) {
        if (!isActiveUnlock(generation, targetEpisode)) {
            return;
        }
        IDJXDramaUnlockListener.CustomAdCallback callback = activeUnlockCallback;
        boolean pageGateUnlock = activePageGateUnlock;
        boolean sdkOwnedUnlock = callback != null && !pageGateUnlock;
        int fallbackEpisode = lastAuthorizedEpisode;
        if (sdkOwnedUnlock) {
            terminatingSdkUnlock = true;
        }
        cancelSdkUnlockRendezvousTimeout();
        sdkUnlockResumePolicy.cancel();
        clearActiveUnlock();
        if (destroyed) {
            return;
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        if (callback != null) {
            try {
                callback.onError();
            } catch (Throwable callbackFailure) {
                Log.w(TAG, "DJX unlock error callback failed", callbackFailure);
            } finally {
                if (sdkOwnedUnlock) {
                    finishHostActivity();
                }
            }
        }
        if (pageGateUnlock) {
            if (fallbackEpisode > 0 && grantedEpisodes.contains(fallbackEpisode)) {
                initializePlayer(fallbackEpisode, 0);
            } else {
                finishHostActivity();
            }
        }
    }

    private void clearActiveUnlock() {
        adSessionRecoveryPolicy.cancel(unlockGeneration);
        unlockPolicy.cancel(unlockGeneration);
        handler.removeCallbacksAndMessages(null);
        if (takuRewardedAdController != null) {
            takuRewardedAdController.cancelActiveSession();
        }
        activeUnlockCallback = null;
        activeUnlockCallbackEpoch = 0L;
        activePageGateUnlock = false;
        activePageGateProgress = 0;
        activeProtocol = null;
        activeSessionId = null;
        activeProviderShowId = null;
        activeSessionPollOnly = false;
        callbackShowSessionId = null;
        callbackShowId = null;
        pollAttempt = 0;
        launchEvidencePollAttempt = 0;
        unlockGeneration = 0L;
        activeUnlockEpisode = 0;
        hideGateOverlay();
    }

    private void resumeAfterSdkUnlock(long callbackEpoch, int episode) {
        if (!sdkUnlockResumePolicy.isPendingResume(callbackEpoch, episode)) {
            return;
        }
        if (destroyed) {
            sdkUnlockResumePolicy.cancel();
            return;
        }
        if (!playerCallbackEpoch.isCurrent(callbackEpoch)
                || hasActiveUnlock() || !grantedEpisodes.contains(episode)) {
            Log.w(TAG, "cancelling invalid pending SDK resume");
            finishHostActivity();
            return;
        }
        lastAuthorizedEpisode = episode;
        Log.i(TAG, "DJX_UNLOCK_RESUME dramaId=" + dramaId + " episode=" + episode);
        initializePlayer(episode, 0);
    }

    private boolean isActiveUnlock(long generation, int targetEpisode) {
        return !destroyed && generation > 0L && generation == unlockGeneration
                && targetEpisode == activeUnlockEpisode
                && hasActiveUnlock()
                && unlockPolicy.isActive(generation, dramaId, targetEpisode);
    }

    private boolean hasActiveUnlock() {
        return activeUnlockCallback != null || activePageGateUnlock;
    }

    private boolean isActiveAd(long generation, int targetEpisode, String expectedSessionId,
                               String expectedShowId) {
        return isActiveUnlock(generation, targetEpisode) && activeSessionId != null
                && expectedSessionId != null
                && expectedSessionId.equals(activeSessionId)
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
        finishHostActivity();
    }

    @Override
    public void onBackPressed() {
        if (hasActiveUnlock()) {
            Log.i(TAG, "cancelled active unlock from host Back");
            boolean pageGateUnlock = activePageGateUnlock;
            failActiveUnlock(
                    unlockGeneration, activeUnlockEpisode,
                    "已取消广告解锁");
            if (pageGateUnlock && !isFinishing()) {
                finishHostActivity();
            }
            return;
        }
        if (sdkUnlockResumePolicy.hasOutstandingResumeScope()) {
            Log.i(TAG, "cancelled pending SDK unlock rendezvous from host Back");
            finishHostActivity();
            return;
        }
        finishHostActivity();
    }

    @Override
    protected void onResume() {
        super.onResume();
        fragmentTransactionsAllowed = true;
        if (pendingResumeEpisode > 0 && !hasActiveUnlock()) {
            int episode = pendingResumeEpisode;
            int progress = pendingResumeProgress;
            initializePlayer(episode, progress);
        }
    }

    @Override
    protected void onPause() {
        fragmentTransactionsAllowed = false;
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        fragmentTransactionsAllowed = false;
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        Log.i(TAG, "destroying protected player activity");
        destroyed = true;
        fragmentTransactionsAllowed = false;
        playerCallbackEpoch.invalidate();
        sdkUnlockResumePolicy.cancel();
        adSessionRecoveryPolicy.cancel(unlockGeneration);
        unlockPolicy.cancel(unlockGeneration);
        handler.removeCallbacksAndMessages(null);
        cancelSdkUnlockRendezvousTimeout();
        sdkUnlockHandler.removeCallbacksAndMessages(null);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        removePlayerFragment();
        destroyWidget();
        hideGateOverlay();
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
