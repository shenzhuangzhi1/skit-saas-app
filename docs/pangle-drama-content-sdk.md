# 穿山甲短剧内容 SDK 接入记录

## 当前状态

移动端已经接入前端桥接层和 Android 原生插件源码：

- JS 服务：`pages/drama/services/pangle-content.js`
- 原生插件名：`SkitPangleDrama`
- 原生插件骨架：`nativeplugins/SkitPangleDrama`
- 配置项：`.env`
- Android 包名：`top.neoshen.xingheyingguan`

```env
VITE_PANGLE_DRAMA_SETTING_FILE=SDK_Setting_5850994.json
VITE_PANGLE_DRAMA_FREE_SET=8
VITE_PANGLE_DRAMA_LOCK_SET=5
```

已放入配置文件：

```text
nativeplugins/SkitPangleDrama/android/assets/SDK_Setting_5850994.json
```

配置文件校验结果：

```text
site_id: 5850994
app_id: 1037672
license_config.PackageName: top.neoshen.xingheyingguan
license_config: present
```

没有真实原生 SDK 时，页面会显示 `真实短剧资源未接入`，不会再用 demo MP4 冒充剧集。

## 官方接入要点

官方文档：`https://www.csjplatform.com/supportcenter/28146`

关键要求：

1. 在内容输出后台录入真实 Android 包名。
2. 点击 `下载SDK参数配置`，把配置 JSON 放到 Android `assets`。
3. 配置文件内 `license_config.PackageName` 必须和正式 APK 包名一致。
4. 先 `DJXSdk.init(...)`，再 `DJXSdk.start(...)`。
5. `start` 成功后再拉列表、分类、历史或打开短剧详情页。

## Maven 仓库

```gradle
maven { url 'https://artifact.bytedance.com/repository/Volcengine/' }
maven { url 'https://artifact.bytedance.com/repository/pangle' }
```

## Android 依赖

当前按用户提供的后台生成版本接入：

```gradle
implementation 'com.pangle_beta.cn:mediation-sdk:7.1.0.5'
implementation 'com.pangle.cn:pangrowth-base:2.9.0.9'
implementation 'com.pangle.cn:pangrowth-djx-sdk-lite:2.9.0.9'
implementation 'com.squareup.okhttp3:okhttp:4.12.0'
```

说明：

- `pangrowth-djx-sdk-lite` 是短剧内容组件。
- `pangrowth-base` 提供 `DJXSdk` 基础能力。
- `mediation-sdk` 是穿山甲/GroMore 融合广告基础包。
- 当前版本视频网络层会运行时访问 `okhttp3.MediaType`，离线 Gradle 工程需要显式加入 `okhttp`。
- 后续若用 Taku 作为主聚合，仍要保证内容 SDK 初始化前广告 SDK/隐私状态按官方要求处理。

## 原生桥接口

前端调用：

```js
const plugin = uni.requireNativePlugin('SkitPangleDrama');
```

方法约定：

```js
plugin.start({ settingFile: 'SDK_Setting_5850994.json', debug: true }, callback);
plugin.list({ page: 1, count: 20, order: true }, callback);
plugin.recommend({ page: 1, count: 20 }, callback);
plugin.history({ page: 1, count: 20 }, callback);
plugin.categoryList({}, callback);
plugin.listWithCategory({ category: '甜宠', categoryId: 0, page: 1, count: 20 }, callback);
plugin.search({ keyword: '关键词', page: 1, count: 20 }, callback);
plugin.listWithIds({ ids: [123456] }, callback);
plugin.openPlayer({ dramaId: 123456, episode: 1, freeSet: 8, lockSet: 5 }, callback);
```

原生侧对应新版 DJX API：

```java
DJXSdk.init(context, "SDK_Setting_5850994.json", config);
DJXSdk.start(listener);
DJXSdk.service().requestAllDrama(...);
DJXSdk.service().requestDramaCategoryList(...);
DJXSdk.service().requestDramaByCategory(...);
DJXSdk.service().requestDrama(...);
DJXSdk.factory().createDramaDetail(...);
```

## 和广告 SDK 的关系

这两件事是分开的：

1. 穿山甲短剧内容 SDK：提供真实短剧列表、分类、历史和原生播放器。
2. GroMore / Taku 广告 SDK：负责激励视频广告，完整观看后业务层解锁剧集。

当前短剧页面的解锁逻辑仍走 `pages/drama/services/reward-ad.js`。完整观看广告后，再允许进入锁定集并打开短剧播放器。

后续如果要严格做“非完全封装模式”的 SDK 内自定义解锁，需要在 `SkitPangleDramaActivity` 中实现 `IDJXDramaUnlockListener`，在 `showCustomAd` 或 `unlockFlowStart` 阶段调起 Taku/GroMore 激励广告，并在奖励有效后回传 DJX 解锁结果。

## HBuilderX 打包要求

当前 `skit-saas-app` 不是完整 Android Gradle 离线工程，不能在这个仓库里直接产出包含 DJX SDK 的正式 APK。可选路径：

1. HBuilderX 自定义基座 / 云打包：
   - 导入 `nativeplugins/SkitPangleDrama`。
   - 确认 Android 包名为 `top.neoshen.xingheyingguan`。
   - 确认 `SDK_Setting_5850994.json` 被打进 Android assets。
   - 加入 Maven 仓库和依赖。
2. uni-app Android 离线打包：
   - 建立完整 Android 工程。
   - 复制 `SkitPangleDramaModule` / `SkitPangleDramaActivity`。
   - 加入穿山甲短剧 SDK Maven 依赖和 assets JSON。

## 后台校验

真实包必须满足：

1. 包名和配置文件 `license_config.PackageName` 一致：`top.neoshen.xingheyingguan`。
2. SHA1 与后台配置一致。
3. `SDK_Setting_5850994.json` 与后台应用一致。
4. minSdkVersion 不低于 21；当前项目设置为 24。
5. 真机或正式自定义基座验证，普通 WebView 预览 APK 不包含该原生 SDK。
