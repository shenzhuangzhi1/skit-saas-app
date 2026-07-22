package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.TakuFailureReason;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;
import top.neoshen.xingheyingguan.ad.ThirdPartySdkBootstrap;

public class SkitTakuAdBridge {
    private static final String TAG = "SkitTakuAd";
    private static final Set<String> PROTOCOL_FIELDS = new HashSet<>(Arrays.asList(
            "protocolVersion", "sessionId", "provider", "placementId",
            "userId", "customData", "scene"));

    private final Activity activity;
    private final WebView webView;
    private final BridgeOriginGuard originGuard;
    private final TakuRewardedAdController rewardedAdController;
    private final ThirdPartySdkBootstrap thirdPartySdkBootstrap;
    private String pendingCallbackId;
    private ThirdPartySdkBootstrap.Registration pendingBootstrapRegistration;
    private boolean destroyed;

    public SkitTakuAdBridge(Activity activity, WebView webView, BridgeOriginGuard originGuard,
                           ThirdPartySdkBootstrap thirdPartySdkBootstrap) {
        this.activity = activity;
        this.webView = webView;
        this.originGuard = originGuard;
        this.thirdPartySdkBootstrap = thirdPartySdkBootstrap;
        this.rewardedAdController = new TakuRewardedAdController(activity);
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
        rewardedAdController.destroy();
        pendingCallbackId = null;
    }

    private void handleMessage(String rawMessage) {
        String callbackId = null;
        AdSessionProtocol protocol = null;
        try {
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            if (!id.matches("[A-Za-z0-9._:-]{1,128}")) {
                throw new IllegalArgumentException("Invalid native callback ID");
            }
            callbackId = id;
            String method = message.optString("method", "");
            if ("cancelRewardedVideo".equals(method)) {
                cancelRewardedVideo(id);
                return;
            }
            if (!"showRewardedVideo".equals(method)) {
                throw new IllegalArgumentException("Unknown Taku native method");
            }
            JSONObject payload = message.optJSONObject("payload");
            protocol = parseProtocol(payload);
            showRewardedVideo(id, protocol);
        } catch (Throwable error) {
            logInternalFailure("bridge-message", error);
            if (callbackId != null) {
                emitTerminalError(callbackId, protocol);
            }
        }
    }

    private void cancelRewardedVideo(String id) {
        boolean cancelled = cancelBootstrapRegistration();
        cancelled = rewardedAdController.cancelPendingSession() || cancelled;
        if (cancelled) {
            pendingCallbackId = null;
        }
        JSONObject result = new JSONObject();
        put(result, "success", true);
        put(result, "cancelled", cancelled);
        emit(id, result, true);
    }

    private void showRewardedVideo(String id, AdSessionProtocol protocol) {
        if (pendingCallbackId != null) {
            throw new IllegalStateException("A Taku session is already active");
        }
        pendingCallbackId = id;
        String presentationUrl = webView.getUrl();
        BootstrapRegistrationSlot registrationSlot = new BootstrapRegistrationSlot(id);
        try {
            ThirdPartySdkBootstrap.Registration registration =
                    thirdPartySdkBootstrap.whenRewardedAdReady(
                            new ThirdPartySdkBootstrap.Callback() {
                @Override
                public void onReady() {
                    activity.runOnUiThread(() -> {
                        registrationSlot.complete();
                        if (destroyed || !id.equals(pendingCallbackId)) {
                            return;
                        }
                        startRewardedVideo(id, protocol, presentationUrl);
                    });
                }

                @Override
                public void onBlocked(int code, String message) {
                    activity.runOnUiThread(() -> {
                        registrationSlot.complete();
                        if (destroyed || !id.equals(pendingCallbackId)) {
                            return;
                        }
                        pendingCallbackId = null;
                        emitTerminalError(id, protocol, bootstrapFailureReason(code));
                    });
                }
            });
            registrationSlot.attach(registration);
        } catch (Throwable error) {
            cancelBootstrapRegistration();
            if (id.equals(pendingCallbackId)) {
                pendingCallbackId = null;
            }
            logInternalFailure("bootstrap", error);
            emitTerminalError(id, protocol);
        }
    }

    private void startRewardedVideo(String id, AdSessionProtocol protocol,
                                    String presentationUrl) {
        try {
            rewardedAdController.start(protocol, telemetry -> {
                boolean terminal = telemetry.getState() == TakuNativeState.CLOSED
                        || telemetry.getState() == TakuNativeState.ERROR;
                try {
                    emit(id, telemetryJson(telemetry), terminal, telemetry.getFailureReason());
                } finally {
                    if (terminal && id.equals(pendingCallbackId)) {
                        pendingCallbackId = null;
                    }
                }
            }, () -> {
                originGuard.requireTrustedTopLevel();
                return presentationUrl != null && presentationUrl.equals(webView.getUrl());
            });
        } catch (Throwable error) {
            rewardedAdController.cancelActiveSession();
            if (id.equals(pendingCallbackId)) {
                pendingCallbackId = null;
            }
            logInternalFailure("startup", error);
            emitTerminalError(id, protocol);
        }
    }

    private boolean cancelBootstrapRegistration() {
        ThirdPartySdkBootstrap.Registration registration = pendingBootstrapRegistration;
        pendingBootstrapRegistration = null;
        if (registration == null) {
            return false;
        }
        registration.cancel();
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
            if (terminal || destroyed || !callbackId.equals(pendingCallbackId)) {
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
