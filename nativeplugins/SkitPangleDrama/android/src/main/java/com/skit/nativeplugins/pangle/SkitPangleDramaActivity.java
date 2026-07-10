package com.skit.nativeplugins.pangle;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentActivity;

import com.bytedance.sdk.dp.DPDramaDetailConfig;
import com.bytedance.sdk.dp.DPSdk;
import com.bytedance.sdk.dp.DPWidgetDramaDetailParams;
import com.bytedance.sdk.dp.IDPWidget;

public class SkitPangleDramaActivity extends FragmentActivity {
    private IDPWidget widget;
    private Fragment fragment;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setId(View.generateViewId());
        setContentView(root, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        if (!DPSdk.isStartSuccess()) {
            finish();
            return;
        }

        DPWidgetDramaDetailParams params = DPWidgetDramaDetailParams.obtain();
        params.id = getIntent().getLongExtra("dramaId", 0L);
        params.index = getIntent().getIntExtra("episode", 1);
        params.mCurrentDuration = getIntent().getIntExtra("progress", 0);

        String mode = getIntent().getStringExtra("mode");
        DPDramaDetailConfig detailConfig = DPDramaDetailConfig.obtain(mode == null ? "common" : mode);
        detailConfig.freeSet = getIntent().getIntExtra("freeSet", 8);
        detailConfig.mIsHideLeftTopTips = true;
        detailConfig.mInfiniteScrollEnabled = false;
        params.mDetailConfig = detailConfig;

        widget = DPSdk.factory().createDramaDetail(params);
        fragment = widget.getFragment();
        getSupportFragmentManager()
                .beginTransaction()
                .replace(root.getId(), fragment, String.valueOf(root.getId()))
                .commit();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
