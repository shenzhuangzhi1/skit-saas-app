package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.TakuFailureReason;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;
import top.neoshen.xingheyingguan.ad.ThirdPartySdkBootstrap;

public class SkitTakuAdBridge {
    private static final String TAG = "SkitTakuAd";
    private static final long DISPLAY_LOAD_TIMEOUT_MILLIS = 14_000L;
    private static final Set<String> PROTOCOL_FIELDS = new HashSet<>(Arrays.asList(
            "protocolVersion", "sessionId", "provider", "placementId",
            "userId", "customData", "scene"));
    private static final Set<String> DISPLAY_FIELDS = new HashSet<>(Arrays.asList(
            "placementId", "scene"));
    private static final Set<String> INTERSTITIAL_CANCEL_FIELDS =
            new HashSet<>(Arrays.asList("requestId"));
    private static final Set<String> BANNER_HIDE_FIELDS = new HashSet<>(Arrays.asList(
            "scene"));

    private final Activity activity;
    private final WebView webView;
    private final BridgeOriginGuard originGuard;
    private final TakuRewardedAdController rewardedAdController;
    private final TakuInterstitialAdController interstitialAdController;
    private final TakuBannerAdController bannerAdController;
    private final ThirdPartySdkBootstrap thirdPartySdkBootstrap;
    private final Handler displayTimeoutHandler = new Handler(Looper.getMainLooper());
    private final RewardedRequestOwnership requestOwnership =
            new RewardedRequestOwnership();
    private final Set<DisplayBootstrapRegistrationSlot> pendingDisplayBootstrapSlots =
            new HashSet<>();
    private ThirdPartySdkBootstrap.Registration pendingBootstrapRegistration;
    private boolean destroyed;

    public SkitTakuAdBridge(Activity activity, WebView webView, BridgeOriginGuard originGuard,
                           ThirdPartySdkBootstrap thirdPartySdkBootstrap,
                           FrameLayout bannerHost) {
        this.activity = activity;
        this.webView = webView;
        this.originGuard = originGuard;
        this.thirdPartySdkBootstrap = thirdPartySdkBootstrap;
        this.rewardedAdController = new TakuRewardedAdController(activity);
        this.interstitialAdController = new TakuInterstitialAdController(activity);
        this.bannerAdController = new TakuBannerAdController(
                activity, bannerHost, this::emitBannerClosed);
    }

    public void postMessage(String rawMessage) {
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                handleMessage(rawMessage);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Rejected Taku bridge call from an untrusted top-level document");
            }
        });
    }

    void destroy() {
        destroyed = true;
        cancelBootstrapRegistration();
        cancelDisplayBootstrapRegistrations();
        rewardedAdController.destroy();
        interstitialAdController.destroy();
        bannerAdController.destroy();
        requestOwnership.clear();
    }

    private void handleMessage(String rawMessage) {
        String callbackId = null;
        String method = null;
        AdSessionProtocol protocol = null;
        TakuDisplayAdRequest displayRequest = null;
        try {
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            if (!id.matches("[A-Za-z0-9._:-]{1,128}")) {
                throw new IllegalArgumentException("Invalid native callback ID");
            }
            callbackId = id;
            method = message.optString("method", "");
            if ("cancelRewardedVideo".equals(method)) {
                cancelRewardedVideo(id);
                return;
            }
            JSONObject payload = message.optJSONObject("payload");
            if ("cancelInterstitial".equals(method)) {
                cancelInterstitial(id, parseInterstitialCancelRequest(payload));
                return;
            }
            if ("showRewardedVideo".equals(method)) {
                protocol = parseProtocol(payload);
                showRewardedVideo(id, protocol);
                return;
            }
            if ("showInterstitial".equals(method)) {
                displayRequest = parseDisplayRequest(
                        payload, TakuDisplayAdRequest.Type.INTERSTITIAL);
                showInterstitial(id, displayRequest);
                return;
            }
            if ("showBanner".equals(method)) {
                displayRequest = parseDisplayRequest(
                        payload, TakuDisplayAdRequest.Type.BANNER);
                showBanner(id, displayRequest);
                return;
            }
            if ("hideBanner".equals(method)) {
                hideBanner(id, parseBannerHideRequest(payload));
                return;
            }
            throw new IllegalArgumentException("Unknown Taku native method");
        } catch (Throwable error) {
            logInternalFailure("bridge-message", error);
            if (callbackId != null) {
                if ("showRewardedVideo".equals(method)
                        || "cancelRewardedVideo".equals(method)) {
                    emitTerminalError(callbackId, protocol);
                } else {
                    emitDisplayResult(callbackId, displayRequest, false,
                            "ERROR", "INVALID_REQUEST");
                }
            }
        }
    }

    private void cancelRewardedVideo(String id) {
        boolean cancelled = false;
        try {
            boolean bootstrapCancelled = cancelBootstrapRegistration();
            if (bootstrapCancelled) {
                RewardedRequestOwnership.Request request = requestOwnership.clear();
                if (request != null) {
                    emitTerminalError(
                            request.getCallbackId(), request.getProtocol(),
                            TakuFailureReason.SDK_FAILURE);
                }
                cancelled = true;
            } else {
                cancelled = rewardedAdController.cancelPendingSession();
            }
        } catch (Throwable cancellationFailure) {
            logInternalFailure("cancel", cancellationFailure);
        }
        JSONObject result = new JSONObject();
        put(result, "success", true);
        put(result, "cancelled", cancelled);
        emit(id, result, true);
    }

    private void showInterstitial(String id, TakuDisplayAdRequest request) {
        awaitDisplaySdk(id, request);
    }

    private void cancelInterstitial(String id, String requestId) {
        boolean cancelled = false;
        try {
            cancelled = cancelPendingInterstitialRequest(requestId);
            if (!cancelled) {
                cancelled = interstitialAdController.cancel(requestId);
            }
        } catch (Throwable cancellationFailure) {
            logInternalFailure("interstitial-cancel", cancellationFailure);
        }
        JSONObject result = new JSONObject();
        put(result, "success", true);
        put(result, "cancelled", cancelled);
        emit(id, result, true);
    }

    private void showBanner(String id, TakuDisplayAdRequest request) {
        awaitDisplaySdk(id, request);
    }

    private void hideBanner(String id, String scene) {
        cancelPendingBannerRequests(scene);
        try {
            bannerAdController.hide(scene,
                    (success, state, failureReason) -> emitDisplayResult(
                            id,
                            new TakuDisplayAdRequest(
                                    TakuDisplayAdRequest.Type.BANNER, "", scene),
                            success, state, failureReason));
        } catch (Throwable error) {
            logInternalFailure("banner-hide", error);
            emitDisplayResult(id,
                    new TakuDisplayAdRequest(
                            TakuDisplayAdRequest.Type.BANNER, "", scene),
                    false, "ERROR", "SDK_FAILURE");
        }
    }

    private void awaitDisplaySdk(String id, TakuDisplayAdRequest request) {
        String presentationUrl = webView.getUrl();
        long deadlineElapsedRealtime =
                SystemClock.elapsedRealtime() + DISPLAY_LOAD_TIMEOUT_MILLIS;
        DisplayBootstrapRegistrationSlot registrationSlot =
                new DisplayBootstrapRegistrationSlot(
                        id, request, deadlineElapsedRealtime);
        pendingDisplayBootstrapSlots.add(registrationSlot);
        try {
            registrationSlot.scheduleTimeout();
            ThirdPartySdkBootstrap.Registration registration =
                    thirdPartySdkBootstrap.whenRewardedAdReady(
                            new ThirdPartySdkBootstrap.Callback() {
                @Override
                public void onReady() {
                    activity.runOnUiThread(() -> {
                        if (!registrationSlot.complete() || destroyed) {
                            return;
                        }
                        startDisplayAd(id, request, presentationUrl,
                                deadlineElapsedRealtime);
                    });
                }

                @Override
                public void onBlocked(int code, String message) {
                    activity.runOnUiThread(() -> {
                        if (!registrationSlot.complete() || destroyed) {
                            return;
                        }
                        emitDisplayResult(id, request, false, "ERROR",
                                bootstrapFailureReason(code).name());
                    });
                }
            });
            registrationSlot.attach(registration);
        } catch (Throwable error) {
            if (registrationSlot.complete() && !destroyed) {
                logInternalFailure("display-bootstrap", error);
                emitDisplayResult(id, request, false, "ERROR", "SDK_FAILURE");
            }
        }
    }

    private void startDisplayAd(String id, TakuDisplayAdRequest request,
                                String presentationUrl,
                                long deadlineElapsedRealtime) {
        try {
            if (request.getType() == TakuDisplayAdRequest.Type.INTERSTITIAL) {
                interstitialAdController.show(id, request,
                        (success, state, failureReason) -> emitDisplayResult(
                                id, request, success, state, failureReason),
                        () -> canPresentFrom(presentationUrl),
                        deadlineElapsedRealtime);
                return;
            }
            bannerAdController.show(request,
                    (success, state, failureReason) -> emitDisplayResult(
                            id, request, success, state, failureReason),
                    () -> canPresentFrom(presentationUrl),
                    deadlineElapsedRealtime);
        } catch (Throwable error) {
            logInternalFailure("display-start", error);
            emitDisplayResult(id, request, false, "ERROR", "SDK_FAILURE");
        }
    }

    private boolean canPresentFrom(String presentationUrl) {
        originGuard.requireTrustedTopLevel();
        return presentationUrl != null && presentationUrl.equals(webView.getUrl());
    }

    private void cancelPendingBannerRequests(String scene) {
        List<DisplayBootstrapRegistrationSlot> pending =
                new ArrayList<>(pendingDisplayBootstrapSlots);
        for (DisplayBootstrapRegistrationSlot slot : pending) {
            if (slot.matchesBannerScene(scene)) {
                slot.cancelAndEmit("CANCELLED");
            }
        }
    }

    private boolean cancelPendingInterstitialRequest(String requestId) {
        List<DisplayBootstrapRegistrationSlot> pending =
                new ArrayList<>(pendingDisplayBootstrapSlots);
        for (DisplayBootstrapRegistrationSlot slot : pending) {
            if (slot.matchesInterstitialRequestId(requestId)) {
                slot.cancelAndEmit("CANCELLED");
                return true;
            }
        }
        return false;
    }

    private void cancelDisplayBootstrapRegistrations() {
        List<DisplayBootstrapRegistrationSlot> pending =
                new ArrayList<>(pendingDisplayBootstrapSlots);
        for (DisplayBootstrapRegistrationSlot slot : pending) {
            slot.cancelSilently();
        }
        pendingDisplayBootstrapSlots.clear();
    }

    private void showRewardedVideo(String id, AdSessionProtocol protocol) {
        requestOwnership.begin(id, protocol);
        BootstrapRegistrationSlot registrationSlot = new BootstrapRegistrationSlot(id);
        try {
            String presentationUrl = webView.getUrl();
            ThirdPartySdkBootstrap.Registration registration =
                    thirdPartySdkBootstrap.whenRewardedAdReady(
                            new ThirdPartySdkBootstrap.Callback() {
                @Override
                public void onReady() {
                    activity.runOnUiThread(() -> {
                        registrationSlot.complete();
                        if (destroyed || !requestOwnership.isCurrent(id)) {
                            return;
                        }
                        startRewardedVideo(id, protocol, presentationUrl);
                    });
                }

                @Override
                public void onBlocked(int code, String message) {
                    activity.runOnUiThread(() -> {
                        registrationSlot.complete();
                        if (destroyed) {
                            return;
                        }
                        terminateRequestIfCurrent(id, bootstrapFailureReason(code));
                    });
                }
            });
            registrationSlot.attach(registration);
        } catch (Throwable error) {
            cancelBootstrapRegistration();
            logInternalFailure("bootstrap", error);
            terminateRequestIfCurrent(id, TakuFailureReason.SDK_FAILURE);
        }
    }

    private void startRewardedVideo(String id, AdSessionProtocol protocol,
                                    String presentationUrl) {
        try {
            rewardedAdController.start(protocol,
                    telemetry -> activity.runOnUiThread(
                            () -> handleRewardedTelemetry(id, telemetry)), () -> {
                originGuard.requireTrustedTopLevel();
                return presentationUrl != null && presentationUrl.equals(webView.getUrl());
            });
        } catch (Throwable error) {
            rewardedAdController.cancelActiveSession();
            logInternalFailure("startup", error);
            terminateRequestIfCurrent(id, TakuFailureReason.SDK_FAILURE);
        }
    }

    private void handleRewardedTelemetry(String id, TakuTelemetry telemetry) {
        boolean terminal = telemetry.getState() == TakuNativeState.CLOSED
                || telemetry.getState() == TakuNativeState.ERROR;
        if (terminal) {
            RewardedRequestOwnership.Request completed =
                    requestOwnership.clearIfCurrent(id);
            if (completed == null) {
                return;
            }
        } else if (!requestOwnership.isCurrent(id)) {
            return;
        }
        emit(id, telemetryJson(telemetry), terminal, telemetry.getFailureReason());
    }

    private boolean cancelBootstrapRegistration() {
        ThirdPartySdkBootstrap.Registration registration = pendingBootstrapRegistration;
        pendingBootstrapRegistration = null;
        if (registration == null) {
            return false;
        }
        try {
            registration.cancel();
        } catch (Throwable cancellationFailure) {
            logInternalFailure("bootstrap-cancel", cancellationFailure);
        }
        return true;
    }

    private final class BootstrapRegistrationSlot {
        private final String callbackId;
        private ThirdPartySdkBootstrap.Registration registration;
        private boolean terminal;

        private BootstrapRegistrationSlot(String callbackId) {
            this.callbackId = callbackId;
        }

        private void attach(ThirdPartySdkBootstrap.Registration value) {
            if (terminal || destroyed || !requestOwnership.isCurrent(callbackId)) {
                value.cancel();
                return;
            }
            registration = value;
            pendingBootstrapRegistration = value;
        }

        private void complete() {
            terminal = true;
            if (pendingBootstrapRegistration == registration) {
                pendingBootstrapRegistration = null;
            }
            registration = null;
        }
    }

    private final class DisplayBootstrapRegistrationSlot {
        private final String callbackId;
        private final TakuDisplayAdRequest request;
        private final long deadlineElapsedRealtime;
        private ThirdPartySdkBootstrap.Registration registration;
        private boolean terminal;
        private final Runnable timeoutRunnable;

        private DisplayBootstrapRegistrationSlot(
                String callbackId, TakuDisplayAdRequest request,
                long deadlineElapsedRealtime) {
            this.callbackId = callbackId;
            this.request = request;
            this.deadlineElapsedRealtime = deadlineElapsedRealtime;
            this.timeoutRunnable = () -> {
                ThirdPartySdkBootstrap.Registration current = registration;
                if (!complete()) {
                    return;
                }
                cancelRegistration(current);
                if (!destroyed) {
                    emitDisplayResult(this.callbackId, this.request, false,
                            "ERROR", "SDK_FAILURE");
                }
            };
        }

        private void scheduleTimeout() {
            long delayMillis = deadlineElapsedRealtime - SystemClock.elapsedRealtime();
            if (delayMillis <= 0L
                    || !displayTimeoutHandler.postDelayed(timeoutRunnable, delayMillis)) {
                timeoutRunnable.run();
            }
        }

        private void attach(ThirdPartySdkBootstrap.Registration value) {
            if (value == null) {
                throw new IllegalArgumentException(
                        "Display bootstrap registration is required");
            }
            if (terminal || destroyed) {
                value.cancel();
                return;
            }
            registration = value;
        }

        private boolean complete() {
            if (terminal) {
                return false;
            }
            terminal = true;
            displayTimeoutHandler.removeCallbacks(timeoutRunnable);
            registration = null;
            pendingDisplayBootstrapSlots.remove(this);
            return true;
        }

        private boolean matchesBannerScene(String scene) {
            return !terminal
                    && request.getType() == TakuDisplayAdRequest.Type.BANNER
                    && request.getScene().equals(scene);
        }

        private boolean matchesInterstitialRequestId(String requestId) {
            return !terminal
                    && request.getType() == TakuDisplayAdRequest.Type.INTERSTITIAL
                    && callbackId.equals(requestId);
        }

        private void cancelAndEmit(String failureReason) {
            ThirdPartySdkBootstrap.Registration current = registration;
            if (!complete()) {
                return;
            }
            cancelRegistration(current);
            if (!destroyed) {
                emitDisplayResult(callbackId, request, false,
                        "ERROR", failureReason);
            }
        }

        private void cancelSilently() {
            ThirdPartySdkBootstrap.Registration current = registration;
            if (!complete()) {
                return;
            }
            cancelRegistration(current);
        }

        private void cancelRegistration(ThirdPartySdkBootstrap.Registration value) {
            if (value == null) {
                return;
            }
            try {
                value.cancel();
            } catch (Throwable cancellationFailure) {
                logInternalFailure("display-bootstrap-cancel", cancellationFailure);
            }
        }
    }

    private void emitTerminalError(String id, AdSessionProtocol protocol) {
        emitTerminalError(id, protocol, TakuFailureReason.SDK_FAILURE);
    }

    private void emitTerminalError(String id, AdSessionProtocol protocol,
                                   TakuFailureReason failureReason) {
        JSONObject result = new JSONObject();
        if (protocol != null) {
            try {
                TakuSessionStateMachine machine = new TakuSessionStateMachine(
                        protocol, "native-" + protocol.getSessionId());
                result = telemetryJson(machine.failed(null, null, null));
            } catch (Throwable invalidFailure) {
                logInternalFailure("terminal-telemetry", invalidFailure);
            }
        }
        if (result.length() == 0) {
            put(result, "nativeState", TakuNativeState.ERROR.name());
            put(result, "success", false);
        }
        emit(id, result, true, failureReason);
    }

    private void terminateRequestIfCurrent(String id, TakuFailureReason failureReason) {
        RewardedRequestOwnership.Request request = requestOwnership.clearIfCurrent(id);
        if (request == null) {
            return;
        }
        emitTerminalError(request.getCallbackId(), request.getProtocol(), failureReason);
    }

    private static TakuFailureReason bootstrapFailureReason(int code) {
        if (code == ThirdPartySdkBootstrap.CONSENT_REQUIRED_CODE) {
            return TakuFailureReason.PRIVACY_CONSENT_REQUIRED;
        }
        if (code == ThirdPartySdkBootstrap.PANGLE_INIT_FAILED_CODE) {
            return TakuFailureReason.PANGLE_INIT_FAILED;
        }
        if (code == ThirdPartySdkBootstrap.TAKU_INIT_FAILED_CODE) {
            return TakuFailureReason.TAKU_INIT_FAILED;
        }
        return TakuFailureReason.SDK_FAILURE;
    }

    private TakuDisplayAdRequest parseDisplayRequest(
            JSONObject payload, TakuDisplayAdRequest.Type type) {
        if (payload == null || payload.length() != DISPLAY_FIELDS.size()) {
            throw new IllegalArgumentException("Display-ad fields are invalid");
        }
        for (String key : DISPLAY_FIELDS) {
            if (!payload.has(key) || !(payload.opt(key) instanceof String)) {
                throw new IllegalArgumentException("Display-ad field is invalid");
            }
        }
        String placementId = payload.optString("placementId", "");
        String scene = payload.optString("scene", "");
        if (!placementId.matches("[A-Za-z0-9._:-]{1,128}")
                || !scene.matches("[A-Za-z0-9._:-]{1,64}")) {
            throw new IllegalArgumentException("Display-ad identifiers are invalid");
        }
        if (BuildConfig.TAKU_REWARD_PLACEMENT_ID.equals(placementId)) {
            throw new IllegalArgumentException(
                    "Rewarded-video placement cannot be used for display ads");
        }
        return new TakuDisplayAdRequest(type, placementId, scene);
    }

    private String parseBannerHideRequest(JSONObject payload) {
        if (payload == null || payload.length() != BANNER_HIDE_FIELDS.size()) {
            throw new IllegalArgumentException("Banner hide fields are invalid");
        }
        if (!payload.has("scene") || !(payload.opt("scene") instanceof String)) {
            throw new IllegalArgumentException("Banner hide scene is invalid");
        }
        String scene = payload.optString("scene", "");
        if (!scene.matches("[A-Za-z0-9._:-]{1,64}")) {
            throw new IllegalArgumentException("Banner hide scene is invalid");
        }
        return scene;
    }

    private String parseInterstitialCancelRequest(JSONObject payload) {
        if (payload == null || payload.length() != INTERSTITIAL_CANCEL_FIELDS.size()) {
            throw new IllegalArgumentException("Interstitial cancel fields are invalid");
        }
        if (!payload.has("requestId") || !(payload.opt("requestId") instanceof String)) {
            throw new IllegalArgumentException("Interstitial request ID is invalid");
        }
        String requestId = payload.optString("requestId", "");
        if (!requestId.matches("[A-Za-z0-9._:-]{1,128}")) {
            throw new IllegalArgumentException("Interstitial request ID is invalid");
        }
        return requestId;
    }

    private AdSessionProtocol parseProtocol(JSONObject payload) {
        if (payload == null || payload.length() != PROTOCOL_FIELDS.size()) {
            throw new IllegalArgumentException("Native ad protocol fields are invalid");
        }
        for (String key : PROTOCOL_FIELDS) {
            if (!payload.has(key)) {
                throw new IllegalArgumentException("Native ad protocol is missing " + key);
            }
        }
        return new AdSessionProtocol(
                payload.optInt("protocolVersion", -1),
                payload.optString("sessionId", ""),
                payload.optString("provider", ""),
                payload.optString("placementId", ""),
                payload.optString("userId", ""),
                payload.optString("customData", ""),
                payload.optString("scene", ""));
    }

    private void emitDisplayResult(String id, TakuDisplayAdRequest request,
                                   boolean success, String state,
                                   String failureReason) {
        JSONObject result = new JSONObject();
        put(result, "success", success);
        put(result, "adType", request == null
                ? "UNKNOWN" : request.getType().name());
        put(result, "state", state);
        if (request != null && request.getPlacementId().length() > 0) {
            put(result, "placementId", request.getPlacementId());
        }
        if (request != null) {
            put(result, "scene", request.getScene());
        }
        if (!success && failureReason != null && failureReason.length() > 0) {
            put(result, "failureReason", failureReason);
        }
        emit(id, result, true);
    }

    private void emitBannerClosed(String scene) {
        JSONObject event = new JSONObject();
        put(event, "state", "CLOSED");
        put(event, "scene", scene);
        String script = "window.__SkitNativeBannerLifecycleEmit && "
                + "window.__SkitNativeBannerLifecycleEmit("
                + JSONObject.quote(event.toString()) + ");";
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                webView.evaluateJavascript(script, null);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Dropped banner lifecycle event after top-level origin changed");
            }
        });
    }

    private JSONObject telemetryJson(TakuTelemetry telemetry) {
        JSONObject result = new JSONObject();
        put(result, "protocolVersion", telemetry.getProtocol().getProtocolVersion());
        put(result, "sessionId", telemetry.getProtocol().getSessionId());
        put(result, "provider", telemetry.getProtocol().getProvider());
        put(result, "placementId", telemetry.getProtocol().getPlacementId());
        put(result, "sdkRequestId", telemetry.getSdkRequestId());
        put(result, "providerShowId", telemetry.getProviderShowId());
        put(result, "networkFirmId", telemetry.getNetworkFirmId());
        put(result, "adsourceId", telemetry.getAdsourceId());
        put(result, "callbackSequence", telemetry.getCallbackSequence());
        put(result, "nativeState", telemetry.getState().name());
        put(result, "clientRewardObserved", telemetry.isClientRewardObserved());
        put(result, "closed", telemetry.isClosed());
        return result;
    }

    private void emit(String id, JSONObject result, boolean terminal) {
        emit(id, result, terminal, TakuFailureReason.NONE);
    }

    private void emit(String id, JSONObject result, boolean terminal,
                      TakuFailureReason failureReason) {
        String failureHint = "";
        if (terminal && failureReason != null && failureReason != TakuFailureReason.NONE) {
            failureHint = "window.__SkitNativeBridgeFailureHint && "
                    + "window.__SkitNativeBridgeFailureHint("
                    + JSONObject.quote(id) + ","
                    + JSONObject.quote(failureReason.name()) + ");";
        }
        String script = failureHint
                + "window.__SkitNativeBridgeEmit && window.__SkitNativeBridgeEmit("
                + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ","
                + terminal + ");";
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                webView.evaluateJavascript(script, null);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Dropped Taku callback after top-level origin changed");
            }
        });
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Throwable ignored) {
        }
    }

    private static void logInternalFailure(String stage, Throwable error) {
        String type = error == null ? "<none>" : error.getClass().getSimpleName();
        if (!type.matches("[A-Za-z0-9_$]{1,64}")) {
            type = "<invalid>";
        }
        Log.w(TAG, "Taku " + stage + " failed: type=" + type);
    }
}
