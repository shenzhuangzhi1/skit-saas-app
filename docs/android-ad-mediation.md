# Android 广告聚合接入记录

## 当前选择

默认短剧解锁广告走 GroMore/穿山甲聚合：

```env
VITE_DRAMA_AD_PROVIDER=gromore
VITE_GROMORE_REWARD_CODE_ID=104223198
```

如果后续切到 Taku 主聚合：

```env
VITE_DRAMA_AD_PROVIDER=taku
VITE_TAKU_REWARD_PLACEMENT_ID=你的Taku激励视频广告位
```

业务页统一调用 `pages/drama/services/reward-ad.js`，不要在页面里直接绑定某一家 SDK。

## 2026-07-09 穿山甲后台确认值

已登录穿山甲后台，在 `多盈剧场` 应用的接入工具生成过 Android 融合 SDK 配置：

- 应用 ID：`5850994`
- 应用名：`多盈剧场`
- SDK：`Android融合SDK 7.6.1.1`
- 引入方式：`Maven`
- 基础依赖：`implementation 'com.pangle.cn:mediation-sdk:7.6.1.1'`
- GroMore 激励视频广告位：`104223198`
- 激励配置：竖屏、非静音、奖励名称 `短剧解锁`、奖励数量 `1`
- 当前后台可见广告网络：穿山甲、优量汇、百度、快手、Sigmob

生成的激励视频核心参数：

```java
new AdSlot.Builder()
    .setCodeId("104223198")
    .setOrientation(TTAdConstant.VERTICAL)
    .setMediationAdSlot(
        new MediationAdSlot.Builder()
            .setMuted(false)
            .setRewardName("短剧解锁")
            .setRewardAmount(1)
            .build()
    )
    .build();
```

## 穿山甲后台 accessTool 配置

入口：

https://www.csjplatform.com/union/media/union/mediation/accessTool

配置建议：

1. 选择 Android。
2. 应用包名使用正式包名，不要使用 HBuilder 标准基座包名。
3. 广告样式至少勾选激励视频。
4. 如果本次让 GroMore 做聚合主控，勾选需要的 ADN 和 adapter，并在初始化时 `.useMediation(true)`。
5. 如果后续让 Taku 做聚合主控，不要把 GroMore 再当成多家 ADN 的二级聚合；应在穿山甲后台保留穿山甲应用和代码位，把 `5850994` / `104223198` 作为穿山甲广告源参数填到 Taku 后台。

官方注意点：

1. `mediation-sdk` 是融合 SDK 基础包，GroMore 聚合能力通过初始化开关控制。
2. 使用聚合必须设置 `useMediation(true)`。
3. 68 版本后 Android `minSdkVersion` 需要不低于 24。
4. SDK 初始化成功后再请求激励视频。
5. 激励回调以 `onRewardArrived` 是否有效为准，不要只用关闭事件解锁。

## Taku 主聚合路径

如果确定最终由 Taku 的 SDK 接入多家广告商：

1. 客户端主 SDK 使用 Taku Android SDK。
2. 客户端代码里只使用 Taku 后台的 `AppID`、`AppKey`、`PlacementID`。
3. 在 Taku 后台添加穿山甲广告源，填写穿山甲 `应用 ID=5850994` 和 `代码位 ID=104223198`。
4. 穿山甲代码位类型必须和 Taku 广告位类型一致：这里都是激励视频。
5. Taku 广告源的排序价格只影响 Taku SDK 请求和展示优先级；有底价权限时按穿山甲真实底价填，没有底价权限时可先手动设置用于排序。

## uni-app 原生插件约定

正式 Android 原生插件需要暴露插件名：

```text
SkitGroMoreAd
```

需要提供方法：

```js
showRewardedVideo(payload, callback)
```

入参：

```json
{
  "codeId": "GroMore激励视频代码位",
  "scene": "drama_unlock",
  "rewardName": "短剧解锁",
  "rewardAmount": 1,
  "extra": {
    "dramaId": "drama id",
    "episode": 3,
    "unlockRange": [3, 4, 5]
  }
}
```

回调成功时返回：

```json
{
  "completed": true,
  "closed": true,
  "isRewardValid": true,
  "provider": "gromore"
}
```

未完整观看或无效激励时必须返回 `completed: false` 或抛错，业务层不会解锁。

## Android 原生侧关键实现

1. 初始化：
   - `TTAdSdk.init(context, config)`
   - `TTAdSdk.start(callback)`
   - `new TTAdConfig.Builder().appId(appId).useMediation(true).supportMultiProcess(false)`

2. 请求激励广告：
   - `TTAdSdk.getAdManager().createAdNative(activity)`
   - `TTAdNative.loadRewardVideoAd(adSlot, listener)`
   - `AdSlot.Builder().setCodeId(codeId).setMediationAdSlot(...)`

3. 展示激励广告：
   - 等 `onRewardVideoCached(TTRewardVideoAd ad)` 后展示
   - `ad.setRewardAdInteractionListener(...)`
   - `ad.showRewardVideoAd(activity)`

4. 解锁条件：
   - `onRewardArrived(isRewardValid, rewardType, extraInfo)` 中 `isRewardValid == true`
   - 或服务端奖励验证成功

## 当前本地限制

`skit-saas-app` 当前不是 Android Gradle 工程，不能直接编译 GroMore AAR。正式接入需要二选一：

1. HBuilderX 正式打包时加入自定义原生插件。
2. 建立 uni-app Android 离线打包工程，把 accessTool 下载的 SDK/adapter 接入 Gradle。

当前页面层已经接好 `SkitGroMoreAd` 桥，原生插件补齐后不需要再改短剧业务页。

## 与短剧内容 SDK 的区别

GroMore / Taku 只处理激励视频广告，不提供真实短剧片源。

真实短剧列表和播放器走穿山甲短剧内容 SDK，接入记录见：

```text
docs/pangle-drama-content-sdk.md
```

当前已新增 `SkitPangleDrama` 前端桥和 Android 原生插件骨架，但真实播放仍需要穿山甲短剧后台下载的 `SDK_Setting_5850994.json` 和 Android 原生 SDK 打包进正式 App。

## 本地构建验证

不要使用 `npx uni build`，它会拉到 npm 上错误的同名旧包。当前机器可用的 HBuilderX CLI 命令：

```bash
NODE_PATH=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules \
UNI_INPUT_DIR=/Users/neo/Desktop/skit/skit-saas-app \
UNI_OUTPUT_DIR=/Users/neo/Desktop/skit/skit-saas-app/unpackage/dist/build/app-android \
/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules/.bin/uni build -p app-android --mode development
```

2026-07-09 已验证通过，产物目录为：

```text
/Users/neo/Desktop/skit/skit-saas-app/unpackage/dist/build/app-android
```

## 临时 WebView 预览 APK

当前仓库不是完整 Android Gradle 工程。为了先在模拟器上看移动端页面，可以使用临时 WebView 壳：

```bash
/Users/neo/Desktop/skit/skit-saas-app/android-preview-webview/build-preview-apk.sh
```

默认打包已验证可渲染的 H5 目录：

```text
/Users/neo/Desktop/skit/skit-saas-app/unpackage/dist/build/h5-apk-preview
```

输出 APK：

```text
/Users/neo/Desktop/skit/skit-saas-app/android-preview-webview/build/skit-preview-debug.apk
```

注意：这个 APK 只用于 UI 预览，不包含 GroMore/Taku 原生 SDK，也不能验证真实广告回调。真实广告验证必须走 HBuilderX 正式打包或 uni-app Android 离线打包工程。
