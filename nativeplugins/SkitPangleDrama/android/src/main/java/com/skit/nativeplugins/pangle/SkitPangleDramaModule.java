package com.skit.nativeplugins.pangle;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;

import com.bytedance.sdk.dp.DPDrama;
import com.bytedance.sdk.dp.DPSdk;
import com.bytedance.sdk.dp.DPSdkConfig;
import com.bytedance.sdk.dp.IDPWidgetFactory;

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

        try {
            if (!initialized) {
                DPSdkConfig config = new DPSdkConfig.Builder().debug(debug).build();
                DPSdk.init(activity.getApplication(), settingFile, config);
                initialized = true;
            }
            if (DPSdk.isStartSuccess()) {
                success(callback, mapOf("started", true, "settingFile", settingFile));
                return;
            }
            DPSdk.start((success, message) -> {
                Log.d(TAG, "start result: " + success + " " + message);
                if (success) {
                    success(callback, mapOf("started", true, "settingFile", settingFile));
                } else {
                    fail(callback, -2, message);
                }
            });
        } catch (Throwable error) {
            fail(callback, -3, error.getMessage());
        }
    }

    @UniJSMethod(uiThread = true)
    public void list(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DPSdk.factory().requestAllDrama(
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                options == null || options.optBoolean("order", true),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void history(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DPSdk.factory().getDramaHistory(
                optInt(options, "page", 1),
                optInt(options, "count", 20),
                dramaCallback(callback)
        ));
    }

    @UniJSMethod(uiThread = true)
    public void categoryList(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DPSdk.factory().requestDramaCategoryList(
                new IDPWidgetFactory.DramaCategoryCallback() {
                    @Override
                    public void onError(int code, String message) {
                        fail(callback, code, message);
                    }

                    @Override
                    public void onSuccess(List<String> list) {
                        success(callback, mapOf("list", list));
                    }
                }
        ));
    }

    @UniJSMethod(uiThread = true)
    public void listWithCategory(JSONObject options, UniJSCallback callback) {
        runWhenStarted(options, callback, () -> DPSdk.factory().requestDramaByCategory(
                optString(options, "category", ""),
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
            DPSdk.factory().requestDrama(ids, dramaCallback(callback));
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
            Intent intent = new Intent(activity, SkitPangleDramaActivity.class);
            intent.putExtra("dramaId", optLong(options, "dramaId", 0L));
            intent.putExtra("episode", optInt(options, "episode", 1));
            intent.putExtra("progress", optInt(options, "progress", 0));
            intent.putExtra("freeSet", optInt(options, "freeSet", 8));
            intent.putExtra("lockSet", optInt(options, "lockSet", 5));
            intent.putExtra("mode", optString(options, "mode", "common"));
            activity.startActivity(intent);
            success(callback, mapOf("opened", true));
        });
    }

    private void runWhenStarted(JSONObject options, UniJSCallback callback, Runnable action) {
        if (DPSdk.isStartSuccess()) {
            action.run();
            return;
        }
        start(options, result -> {
            if (DPSdk.isStartSuccess()) {
                action.run();
            } else {
                fail(callback, -4, "DPSdk start failed");
            }
        });
    }

    private IDPWidgetFactory.DramaCallback dramaCallback(UniJSCallback callback) {
        return new IDPWidgetFactory.DramaCallback() {
            @Override
            public void onError(int code, String message) {
                fail(callback, code, message);
            }

            @Override
            public void onSuccess(List<? extends DPDrama> list, Map<String, Object> extra) {
                success(callback, mapOf("list", getData(list), "extra", extra));
            }
        };
    }

    private List<Map<String, Object>> getData(List<? extends DPDrama> list) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (list == null) {
            return result;
        }
        for (DPDrama item : list) {
            Map<String, Object> obj = new HashMap<>();
            obj.put("id", item.id);
            obj.put("index", item.index);
            obj.put("title", item.title);
            obj.put("coverImage", item.coverImage);
            obj.put("status", item.status);
            obj.put("total", item.total);
            obj.put("type", item.type);
            obj.put("desc", item.desc);
            obj.put("scriptName", item.scriptName);
            obj.put("scriptAuthor", item.scriptAuthor);
            obj.put("actionTime", item.actionTime);
            obj.put("createTime", item.createTime);
            result.add(obj);
        }
        return result;
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
