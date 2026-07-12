package com.skit.nativeplugins.pangle;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;

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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import io.dcloud.feature.uniapp.annotation.UniJSMethod;
import io.dcloud.feature.uniapp.bridge.UniJSCallback;
import io.dcloud.feature.uniapp.common.UniModule;

public class SkitPangleDramaModule extends UniModule {
    private static final String TAG = "SkitPangleDrama";
    private static final String DEFAULT_SETTING_FILE = "SDK_Setting_5850994.json";
    private static boolean initialized = false;
    private static String settingFile = DEFAULT_SETTING_FILE;

    @UniJSMethod(uiThread = true)
    public void start(JSONObject options, UniJSCallback callback) {
        Activity activity = getActivity();
        if (activity == null) {
            fail(callback, -1, "Activity unavailable");
            return;
        }

        settingFile = optString(options, "settingFile", DEFAULT_SETTING_FILE);
        boolean debug = options != null && options.optBoolean("debug", false);

        PangleAdSdkInitializer.ensureStarted(activity.getApplicationContext(), debug, settingFile,
                new PangleAdSdkInitializer.Callback() {
            @Override
            public void onSuccess() {
                activity.runOnUiThread(() -> startContentSdk(options, callback, debug));
            }

            @Override
            public void onFailure(int code, String message) {
                fail(callback, code, message);
            }
        });
    }

    private void startContentSdk(JSONObject options, UniJSCallback callback, boolean debug) {
        Activity activity = getActivity();
        if (activity == null) {
            fail(callback, -1, "Activity unavailable");
            return;
        }
        try {
            if (!initialized) {
                DJXSdkConfig config = new DJXSdkConfig.Builder()
                        .debug(debug)
                        .build();
                DJXSdk.init(activity.getApplicationContext(), settingFile, config);
                initialized = true;
            }
            if (DJXSdk.isStartSuccess()) {
                success(callback, mapOf(
                        "success", true,
                        "started", true,
                        "settingFile", settingFile,
                        "version", DJXSdk.getVersion()
                ));
                return;
            }
            DJXSdk.start((success, message, error) -> {
                Log.d(TAG, "start result: " + success + " " + message + " " + error);
                if (success) {
                    success(callback, mapOf(
                            "success", true,
                            "started", true,
                            "settingFile", settingFile,
                            "version", DJXSdk.getVersion()
                    ));
                } else {
                    fail(callback, errorCode(error, -2), errorMessage(error, message));
                }
            });
        } catch (Throwable error) {
            fail(callback, -3, error.getMessage());
        }
    }

    @UniJSMethod(uiThread = true)
    public void list(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().requestAllDrama(
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                options == null || options.optBoolean("order", true),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void recommend(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().requestAllDramaByRecommend(
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void history(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().getDramaHistory(
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void categoryList(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().requestDramaCategoryList(
                new IDJXService.IDJXCallback<List<String>>() {
                    @Override
                    public void onSuccess(List<String> list, DJXOthers others) {
                        success(callback, mapOf(
                                "success", true,
                                "list", list == null ? new ArrayList<String>() : list,
                                "extra", othersToMap(others)
                        ));
                    }

                    @Override
                    public void onError(DJXError error) {
                        fail(callback, errorCode(error, -5), errorMessage(error, "requestDramaCategoryList failed"));
                    }
                }
        ));
    }

    @UniJSMethod(uiThread = true)
    public void listWithCategory(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().requestDramaByCategory(
                optString(options, "category", ""),
                optInt(options, "categoryId", optInt(options, "typeId", 0)),
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void search(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DJXSdk.service().searchDrama(
                optString(options, "keyword", optString(options, "query", "")),
                options == null || options.optBoolean("strict", true),
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void listWithIds(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> {
            List<Long> ids = new ArrayList<>();
            JSONArray rawIds = options == null ? null : options.optJSONArray("ids");
            if (rawIds != null) {
                for (int i = 0; i < rawIds.length(); i++) {
                    ids.add(rawIds.optLong(i));
                }
            }
            DJXSdk.service().requestDrama(ids, dramaCallback(callback));
        });
    }

    @UniJSMethod(uiThread = true)
    public void openPlayer(JSONObject options, UniJSCallback callback) {
        Activity activity = getActivity();
        if (activity == null) {
            fail(callback, -1, "Activity unavailable");
            return;
        }
        runWhenStarted(options, callback, () -> {
            long dramaId = optLong(options, "dramaId", 0L);
            if (dramaId <= 0L) {
                fail(callback, -6, "Invalid Pangle dramaId");
                return;
            }
            Intent intent = new Intent(activity, SkitPangleDramaActivity.class);
            intent.putExtra("dramaId", dramaId);
            intent.putExtra("episode", optInt(options, "episode", 1));
            intent.putExtra("progress", optInt(options, "progress", 0));
            intent.putExtra("freeSet", optInt(options, "freeSet", 8));
            intent.putExtra("lockSet", optInt(options, "lockSet", 5));
            intent.putExtra("unlockMode", optString(options, "unlockMode", "specific"));
            activity.startActivity(intent);
            success(callback, mapOf("success", true, "opened", true));
        });
    }

    private void runWhenStarted(JSONObject options, UniJSCallback callback, Runnable action) {
        if (DJXSdk.isStartSuccess()) {
            action.run();
            return;
        }
        start(options, result -> {
            if (DJXSdk.isStartSuccess()) {
                action.run();
            } else {
                fail(callback, -4, "DJXSdk start failed");
            }
        });
    }

    private IDJXService.IDJXCallback<List<? extends DJXDrama>> dramaCallback(UniJSCallback callback) {
        return new IDJXService.IDJXCallback<List<? extends DJXDrama>>() {
            @Override
            public void onSuccess(List<? extends DJXDrama> list, DJXOthers others) {
                success(callback, mapOf(
                        "success", true,
                        "list", getData(list),
                        "extra", othersToMap(others)
                ));
            }

            @Override
            public void onError(DJXError error) {
                fail(callback, errorCode(error, -5), errorMessage(error, "request drama failed"));
            }
        };
    }

    private List<Map<String, Object>> getData(List<? extends DJXDrama> list) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (list == null) {
            return result;
        }
        for (DJXDrama item : list) {
            Map<String, Object> obj = new HashMap<>();
            obj.put("id", item.id);
            obj.put("index", item.index);
            obj.put("title", item.title);
            obj.put("coverImage", item.coverImage);
            obj.put("coverImages", imageList(item.coverImages2));
            obj.put("status", item.status);
            obj.put("total", item.total);
            obj.put("unlockIndex", item.unlockIndex);
            obj.put("type", item.type);
            obj.put("typeId", item.typeId);
            obj.put("desc", item.desc);
            obj.put("scriptName", item.scriptName);
            obj.put("scriptAuthor", item.scriptAuthor);
            obj.put("actionTime", item.actionTime);
            obj.put("createTime", item.createTime);
            obj.put("freeSet", item.freeSet);
            obj.put("lockSet", item.lockSet);
            obj.put("icpNumber", item.icpNumber);
            obj.put("isFavor", item.isFavor);
            obj.put("favoriteCount", item.favoriteCount);
            obj.put("groupId", item.groupId);
            obj.put("recMap", item.recMap);
            result.add(obj);
        }
        return result;
    }

    private List<Map<String, Object>> imageList(List<DJXImage> images) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (images == null) {
            return result;
        }
        for (DJXImage image : images) {
            result.add(mapOf(
                    "url", image.url,
                    "backupUrl", image.backupUrl,
                    "definition", image.definition
            ));
        }
        return result;
    }

    private static Map<String, Object> othersToMap(DJXOthers others) {
        if (others == null) {
            return new HashMap<>();
        }
        return mapOf(
                "hasMore", others.hasMore,
                "requestId", others.requestId,
                "total", others.total,
                "others", others.others
        );
    }

    private Activity getActivity() {
        if (mUniSDKInstance == null || mUniSDKInstance.getContext() == null) {
            return null;
        }
        if (mUniSDKInstance.getContext() instanceof Activity) {
            return (Activity) mUniSDKInstance.getContext();
        }
        return null;
    }

    private static void success(UniJSCallback callback, Object value) {
        if (callback != null) {
            callback.invoke(value);
        }
    }

    private static void fail(UniJSCallback callback, int code, String message) {
        Map<String, Object> result = new HashMap<>();
        result.put("success", false);
        result.put("code", code);
        result.put("message", message == null ? "unknown error" : message);
        if (callback != null) {
            callback.invoke(result);
        }
    }

    private static int errorCode(DJXError error, int fallback) {
        return error == null ? fallback : error.code;
    }

    private static String errorMessage(DJXError error, String fallback) {
        if (error != null && error.msg != null && error.msg.length() > 0) {
            return error.msg;
        }
        return fallback == null ? "unknown error" : fallback;
    }

    private static Map<String, Object> mapOf(Object... pairs) {
        Map<String, Object> map = new HashMap<>();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            map.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return map;
    }

    private static String optString(JSONObject options, String key, String fallback) {
        return options == null ? fallback : options.optString(key, fallback);
    }

    private static int optInt(JSONObject options, String key, int fallback) {
        return options == null ? fallback : options.optInt(key, fallback);
    }

    private static long optLong(JSONObject options, String key, long fallback) {
        if (options == null) {
            return fallback;
        }
        try {
            Object value = options.opt(key);
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
            return Long.parseLong(String.valueOf(value));
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
