package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;
import android.webkit.WebView;

import com.bytedance.sdk.djx.DJXSdk;
import com.bytedance.sdk.djx.DJXSdkConfig;
import com.bytedance.sdk.djx.IDJXService;
import com.bytedance.sdk.djx.model.DJXDrama;
import com.bytedance.sdk.djx.model.DJXError;
import com.bytedance.sdk.djx.model.DJXImage;
import com.bytedance.sdk.djx.model.DJXOthers;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import top.neoshen.xingheyingguan.ad.NativePlayerGrant;
import top.neoshen.xingheyingguan.ad.SafeEvidenceReference;

public class SkitPangleDramaBridge {
    private static final String TAG = "SkitPangleDrama";
    private static final String DEFAULT_SETTING_FILE = BuildConfig.PANGLE_SETTING_ASSET;
    private static boolean initialized = false;

    private final Activity activity;
    private final WebView webView;
    private final BridgeOriginGuard originGuard;

    public SkitPangleDramaBridge(Activity activity, WebView webView,
                                 BridgeOriginGuard originGuard) {
        this.activity = activity;
        this.webView = webView;
        this.originGuard = originGuard;
    }

    public void postMessage(String rawMessage) {
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                handleMessage(rawMessage);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Rejected Pangle bridge call from an untrusted top-level document");
            }
        });
    }

    private void handleMessage(String rawMessage) {
        String callbackId = "";
        try {
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            if (!id.matches("[A-Za-z0-9._:-]{1,128}")) {
                throw new IllegalArgumentException("Invalid native callback ID");
            }
            callbackId = id;
            String method = message.optString("method", "");
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null) {
                payload = new JSONObject();
            }
            final JSONObject args = payload;

            switch (method) {
                case "start":
                    ensureStarted(args, id, () -> resolve(id, startedJson()));
                    break;
                case "list":
                    runWhenStarted(args, id, () -> DJXSdk.service().requestAllDrama(
                            args.optInt("page", 1),
                            args.optInt("count", 20),
                            args.optBoolean("order", true),
                            dramaCallback(id)));
                    break;
                case "recommend":
                    runWhenStarted(args, id, () -> DJXSdk.service().requestAllDramaByRecommend(
                            args.optInt("page", 1),
                            args.optInt("count", 20),
                            dramaCallback(id)));
                    break;
                case "history":
                    runWhenStarted(args, id, () -> DJXSdk.service().getDramaHistory(
                            args.optInt("page", 1),
                            args.optInt("count", 20),
                            dramaCallback(id)));
                    break;
                case "categoryList":
                    runWhenStarted(args, id, () -> DJXSdk.service().requestDramaCategoryList(
                            new IDJXService.IDJXCallback<List<String>>() {
                                @Override
                                public void onSuccess(List<String> data, DJXOthers others) {
                                    JSONObject result = ok();
                                    put(result, "list", new JSONArray(data == null ? new ArrayList<String>() : data));
                                    put(result, "extra", othersJson(others));
                                    resolve(id, result);
                                }

                                @Override
                                public void onError(DJXError error) {
                                    resolve(id, errorJson(error, -5, "requestDramaCategoryList failed"));
                                }
                            }));
                    break;
                case "listWithCategory":
                    runWhenStarted(args, id, () -> DJXSdk.service().requestDramaByCategory(
                            args.optString("category", ""),
                            args.optInt("categoryId", args.optInt("typeId", 0)),
                            args.optInt("page", 1),
                            args.optInt("count", 20),
                            dramaCallback(id)));
                    break;
                case "search":
                    runWhenStarted(args, id, () -> DJXSdk.service().searchDrama(
                            args.optString("keyword", args.optString("query", "")),
                            args.optBoolean("strict", true),
                            args.optInt("page", 1),
                            args.optInt("count", 20),
                            dramaCallback(id)));
                    break;
                case "listWithIds":
                    runWhenStarted(args, id, () -> DJXSdk.service().requestDrama(
                            ids(args.optJSONArray("ids")),
                            dramaCallback(id)));
                    break;
                case "openPlayer":
                    runWhenStarted(args, id, () -> {
                        long dramaId = optLong(args, "dramaId", 0L);
                        if (dramaId <= 0L) {
                            resolve(id, fail(-6, "Invalid Pangle dramaId"));
                            return;
                        }
                        int episode = args.optInt("episode", 1);
                        if (episode <= 0) {
                            resolve(id, fail(-6, "Invalid Pangle episode"));
                            return;
                        }
                        NativePlayerGrant playerGrant = parsePlayerGrant(
                                args.optJSONObject("playerGrant"), dramaId);
                        RewardEvidenceRefs rewardEvidence = parseRewardEvidence(
                                args.optJSONObject("rewardEvidence"),
                                dramaId,
                                episode,
                                "server_verified_reward".equals(args.optString("source", "")));
                        Intent intent = new Intent(activity, DramaPlayerActivity.class);
                        intent.putExtra("dramaId", dramaId);
                        intent.putExtra("episode", episode);
                        intent.putExtra("progress", args.optInt("progress", 0));
                        intent.putExtra("playerGrantId", playerGrant.getGrantId());
                        intent.putExtra("playerGrantDramaId", playerGrant.getDramaId());
                        intent.putExtra("playerGrantToken", playerGrant.getGrantToken());
                        intent.putExtra("playerGrantExpiresAt", playerGrant.getExpiresAtEpochMillis());
                        if (rewardEvidence.isPresent()) {
                            intent.putExtra("rewardSessionRef", rewardEvidence.sessionRef);
                            intent.putExtra("rewardShowRef", rewardEvidence.showRef);
                        }
                        activity.startActivity(intent);
                        JSONObject result = ok();
                        put(result, "opened", true);
                        resolve(id, result);
                    });
                    break;
                default:
                    resolve(id, fail(-404, "Unknown native method: " + method));
                    break;
            }
        } catch (Throwable error) {
            Log.w(TAG, "Rejected invalid Pangle bridge message");
            if (!callbackId.isEmpty()) {
                resolve(callbackId, fail(-400, "Invalid native request"));
            }
        }
    }

    private void ensureStarted(JSONObject payload, String id, Runnable action) {
        boolean debug = BuildConfig.DEBUG && payload.optBoolean("debug", false);
        PangleAdSdkInitializer.ensureStarted(activity.getApplicationContext(), debug, new PangleAdSdkInitializer.Callback() {
            @Override
            public void onSuccess() {
                activity.runOnUiThread(() -> startContentSdk(debug, id, action));
            }

            @Override
            public void onFailure(int code, String message) {
                resolve(id, fail(code, message));
            }
        });
    }

    private void startContentSdk(boolean debug, String id, Runnable action) {
        try {
            if (!initialized) {
                DJXSdkConfig config = new DJXSdkConfig.Builder()
                        .debug(debug)
                        .build();
                DJXSdk.init(activity.getApplicationContext(), DEFAULT_SETTING_FILE, config);
                initialized = true;
            }
            if (DJXSdk.isStartSuccess()) {
                runAction(id, action);
                return;
            }
            DJXSdk.start((success, message, error) -> {
                Log.i(TAG, "DJXSdk start completed success=" + success);
                if (success) {
                    activity.runOnUiThread(() -> runAction(id, action));
                } else {
                    resolve(id, errorJson(error, -2, message));
                }
            });
        } catch (Throwable error) {
            resolve(id, fail(-3, error.getMessage()));
        }
    }

    private void runAction(String id, Runnable action) {
        try {
            originGuard.requireTrustedTopLevel();
            action.run();
        } catch (SecurityException rejectedOrigin) {
            Log.w(TAG, "Dropped Pangle action after top-level origin changed");
        } catch (Throwable failure) {
            Log.w(TAG, "Pangle native action failed");
            resolve(id, fail(-3, "Native content request failed"));
        }
    }

    private void runWhenStarted(JSONObject payload, String id, Runnable action) {
        ensureStarted(payload, id, action);
    }

    private IDJXService.IDJXCallback<List<? extends DJXDrama>> dramaCallback(String id) {
        return new IDJXService.IDJXCallback<List<? extends DJXDrama>>() {
            @Override
            public void onSuccess(List<? extends DJXDrama> data, DJXOthers others) {
                Log.i(TAG, "real drama list success count=" + (data == null ? 0 : data.size()));
                JSONObject result = ok();
                put(result, "list", dramaList(data));
                put(result, "extra", othersJson(others));
                resolve(id, result);
            }

            @Override
            public void onError(DJXError error) {
                resolve(id, errorJson(error, -5, "request drama failed"));
            }
        };
    }

    private JSONArray dramaList(List<? extends DJXDrama> dramas) {
        JSONArray array = new JSONArray();
        if (dramas == null) {
            return array;
        }
        for (DJXDrama drama : dramas) {
            JSONObject item = new JSONObject();
            put(item, "id", drama.id);
            put(item, "index", drama.index);
            put(item, "title", drama.title);
            put(item, "coverImage", drama.coverImage);
            put(item, "coverImages", imageList(drama.coverImages2));
            put(item, "status", drama.status);
            put(item, "total", drama.total);
            put(item, "unlockIndex", drama.unlockIndex);
            put(item, "type", drama.type);
            put(item, "typeId", drama.typeId);
            put(item, "desc", drama.desc);
            put(item, "scriptName", drama.scriptName);
            put(item, "scriptAuthor", drama.scriptAuthor);
            put(item, "createTime", drama.createTime);
            put(item, "actionTime", drama.actionTime);
            put(item, "freeSet", drama.freeSet);
            put(item, "lockSet", drama.lockSet);
            put(item, "icpNumber", drama.icpNumber);
            put(item, "isFavor", drama.isFavor);
            put(item, "favoriteCount", drama.favoriteCount);
            put(item, "groupId", drama.groupId);
            array.put(item);
        }
        return array;
    }

    private JSONArray imageList(List<DJXImage> images) {
        JSONArray array = new JSONArray();
        if (images == null) {
            return array;
        }
        for (DJXImage image : images) {
            JSONObject item = new JSONObject();
            put(item, "url", image.url);
            put(item, "backupUrl", image.backupUrl);
            put(item, "definition", image.definition);
            array.put(item);
        }
        return array;
    }

    private JSONObject othersJson(DJXOthers others) {
        JSONObject result = new JSONObject();
        if (others == null) {
            return result;
        }
        put(result, "hasMore", others.hasMore);
        put(result, "requestId", others.requestId);
        put(result, "total", others.total);
        return result;
    }

    private JSONObject startedJson() {
        JSONObject result = ok();
        put(result, "started", true);
        put(result, "settingFile", DEFAULT_SETTING_FILE);
        put(result, "version", DJXSdk.getVersion());
        return result;
    }

    private JSONObject errorJson(DJXError error, int fallbackCode, String fallbackMessage) {
        if (error == null) {
            return fail(fallbackCode, fallbackMessage);
        }
        return fail(error.code, error.msg == null ? fallbackMessage : error.msg);
    }

    private JSONObject ok() {
        JSONObject result = new JSONObject();
        put(result, "success", true);
        return result;
    }

    private JSONObject fail(int code, String message) {
        JSONObject result = new JSONObject();
        put(result, "success", false);
        put(result, "code", code);
        put(result, "message", message == null ? "unknown error" : message);
        return result;
    }

    private void resolve(String id, JSONObject result) {
        if (id == null || id.length() == 0) {
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                String script = "window.__SkitNativeBridgeResolve && window.__SkitNativeBridgeResolve("
                        + JSONObject.quote(id)
                        + ","
                        + JSONObject.quote(result.toString())
                        + ");";
                webView.evaluateJavascript(script, null);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Dropped Pangle callback after top-level origin changed");
            }
        });
    }

    private static List<Long> ids(JSONArray rawIds) {
        List<Long> result = new ArrayList<>();
        if (rawIds == null) {
            return result;
        }
        for (int i = 0; i < rawIds.length(); i++) {
            result.add(rawIds.optLong(i));
        }
        return result;
    }

    private static long optLong(JSONObject payload, String key, long fallback) {
        try {
            Object value = payload.opt(key);
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
            return Long.parseLong(String.valueOf(value));
        } catch (Throwable ignored) {
            return fallback;
        }
    }

    private static NativePlayerGrant parsePlayerGrant(JSONObject value, long expectedDramaId) {
        if (value == null || value.length() != 4 || !value.has("grantId")
                || !value.has("dramaId") || !value.has("expiresAt")
                || !value.has("grantToken")) {
            throw new IllegalArgumentException("Server player grant is missing");
        }
        long grantId = optLong(value, "grantId", 0L);
        long dramaId = optLong(value, "dramaId", 0L);
        long expiresAt = optLong(value, "expiresAt", 0L);
        NativePlayerGrant grant = new NativePlayerGrant(
                grantId, dramaId, value.optString("grantToken", ""),
                expiresAt, System.currentTimeMillis());
        grant.requireDrama(expectedDramaId);
        return grant;
    }

    private static RewardEvidenceRefs parseRewardEvidence(JSONObject value, long expectedDramaId,
                                                           int expectedEpisode,
                                                           boolean required) {
        if (value == null) {
            if (required) {
                throw new IllegalArgumentException("Server reward evidence is required");
            }
            return RewardEvidenceRefs.absent();
        }
        if (value.length() != 4 || !value.has("dramaId") || !value.has("episodeNo")
                || !value.has("sessionId") || !value.has("providerShowId")) {
            throw new IllegalArgumentException("Server reward evidence is incomplete");
        }
        long dramaId = optLong(value, "dramaId", 0L);
        int episodeNo = value.optInt("episodeNo", 0);
        String sessionId = value.optString("sessionId", "");
        String providerShowId = value.optString("providerShowId", "");
        if (dramaId != expectedDramaId || episodeNo != expectedEpisode
                || !sessionId.matches("[A-Za-z0-9_-]{22}")
                || !providerShowId.matches("[A-Za-z0-9._:/-]{1,128}")) {
            throw new IllegalArgumentException("Server reward evidence scope is invalid");
        }
        return new RewardEvidenceRefs(
                SafeEvidenceReference.of(sessionId),
                SafeEvidenceReference.of(providerShowId));
    }

    private static final class RewardEvidenceRefs {
        private final String sessionRef;
        private final String showRef;

        private RewardEvidenceRefs(String sessionRef, String showRef) {
            this.sessionRef = sessionRef;
            this.showRef = showRef;
        }

        private static RewardEvidenceRefs absent() {
            return new RewardEvidenceRefs(null, null);
        }

        private boolean isPresent() {
            return sessionRef != null && showRef != null;
        }
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Throwable ignored) {
        }
    }
}
