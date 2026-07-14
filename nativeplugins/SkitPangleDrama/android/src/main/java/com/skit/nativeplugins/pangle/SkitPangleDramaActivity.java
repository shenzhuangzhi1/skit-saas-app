package com.skit.nativeplugins.pangle;

import android.app.Activity;
import android.app.Fragment;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
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

import java.util.Map;

public class SkitPangleDramaActivity extends Activity {
    private static final String TAG = "SkitPangleDramaActivity";
    private IDJXWidget widget;
    private Fragment fragment;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setId(View.generateViewId());
        setContentView(root, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        if (!DJXSdk.isStartSuccess()) {
            finish();
            return;
        }

        long dramaId = getIntent().getLongExtra("dramaId", 0L);
        if (dramaId <= 0L) {
            finish();
            return;
        }
        int episode = getIntent().getIntExtra("episode", 1);
        int freeSet = getIntent().getIntExtra("freeSet", 8);
        int lockSet = getIntent().getIntExtra("lockSet", 5);
        int progress = getIntent().getIntExtra("progress", 0);
        String unlockMode = getIntent().getStringExtra("unlockMode");

        boolean useCommonUnlock = "common".equalsIgnoreCase(unlockMode);
        DJXDramaUnlockAdMode mode = useCommonUnlock
                ? DJXDramaUnlockAdMode.MODE_COMMON
                : DJXDramaUnlockAdMode.MODE_SPECIFIC;

        DJXDramaDetailConfig detailConfig = DJXDramaDetailConfig
                .obtain(mode, freeSet, useCommonUnlock ? null : createUnlockListener(dramaId, lockSet))
                .infiniteScrollEnabled(false)
                .hideCellularToast(true)
                .adListener(createAdListener())
                .listener(new IDJXDramaListener() {
                    @Override
                    public void onDJXClose() {
                        finish();
                    }

                    @Override
                    public void onDJXRequestFail(int code, String message, Map<String, Object> extra) {
                        super.onDJXRequestFail(code, message, extra);
                    }
                });

        DJXWidgetDramaDetailParams params = DJXWidgetDramaDetailParams
                .obtain(dramaId, episode, detailConfig)
                .currentDuration(progress);

        widget = DJXSdk.factory().createDramaDetail(params);
        fragment = widget.getFragment2();
        getFragmentManager()
                .beginTransaction()
                .replace(root.getId(), fragment, String.valueOf(root.getId()))
                .commit();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private IDJXDramaUnlockListener createUnlockListener(long fallbackDramaId, int fallbackLockSet) {
        int safeLockSet = Math.max(1, fallbackLockSet);
        return new IDJXDramaUnlockListener() {
            @Override
            public void unlockFlowStart(
                    DJXDrama drama,
                    IDJXDramaUnlockListener.UnlockCallback callback,
                    Map<String, ? extends Object> extra) {
                long targetDramaId = drama == null || drama.id <= 0L ? fallbackDramaId : drama.id;
                Log.i(TAG, "unlockFlowStart dramaId=" + targetDramaId + ", lockSet=" + safeLockSet);
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
            public void unlockFlowEnd(
                    DJXDrama drama,
                    IDJXDramaUnlockListener.UnlockErrorStatus status,
                    Map<String, ? extends Object> extra) {
                Log.i(TAG, "unlockFlowEnd status=" + status + ", extra=" + extra);
            }

            @Override
            public void showCustomAd(
                    DJXDrama drama,
                    IDJXDramaUnlockListener.CustomAdCallback callback) {
                if (callback == null) {
                    return;
                }
                Log.w(TAG, "custom reward unavailable without server-verified entitlement");
                callback.onError();
            }
        };
    }

    private IDJXAdListener createAdListener() {
        return new IDJXAdListener() {
            @Override
            public void onDJXAdRequestFail(int code, String message, Map<String, Object> extra) {
                Log.w(TAG, "DJX ad request failed code=" + code + ", message=" + message + ", extra=" + extra);
            }
        };
    }

    @Override
    protected void onDestroy() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (widget != null) {
            widget.destroy();
            widget = null;
        }
        super.onDestroy();
    }
}
