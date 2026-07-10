# 穿山甲短剧内容 SDK 接入记录

## 当前状态

移动端已经接入前端桥接层：

- JS 服务：`pages/drama/services/pangle-content.js`
- 原生插件名：`SkitPangleDrama`
- 原生插件骨架：`nativeplugins/SkitPangleDrama`
- 配置项：`.env`

```env
VITE_PANGLE_DRAMA_SETTING_FILE=SDK_Setting_5850994.json
VITE_PANGLE_DRAMA_FREE_SET=8
VITE_PANGLE_DRAMA_LOCK_SET=5
```

没有真实原生 SDK 时，页面会显示 `真实短剧资源未接入`，不会再用 demo MP4 冒充剧集。

2026-07-09 平台侧检查结果：

- 内容输出应用已存在：`多盈剧场` / `5850994` / `内容SDK`。
- 内容输出接入管理页显示状态：`审核中`，并提示 `申请证明审核中`。
- `下载SDK参数配置` 链接当前是禁用样式。
- 直接访问平台给出的下载接口 `download_sdk_setting?site_id=5850994` 返回 `PG0011 / 系统错误`，未下载到配置文件。
- 结论：当前不是代码问题，而是平台侧内容输出应用仍在审核或资料未完全通过；审核通过后再下载 `SDK_Setting_5850994.json` 并放入 Android assets。

## 和广告 SDK 的关系

这两件事是分开的：

1. 穿山甲短剧内容 SDK：提供真实短剧列表、分类、历史和原生播放器。
2. GroMore / Taku 广告 SDK：负责激励视频广告，完整观看后业务层解锁剧集。

当前短剧页面的解锁逻辑仍走 `pages/drama/services/reward-ad.js`。完整观看广告后，再允许进入锁定集并打开短剧播放器。

## 必须从后台拿到的文件

穿山甲短剧内容 SDK 不是通过 `videoUrl` 播放。它需要后台下载的配置 JSON 初始化：

```java
DPSdkConfig config = new DPSdkConfig.Builder().debug(BuildConfig.DEBUG).build();
DPSdk.init(application, "SDK_Setting_5850994.json", config);
DPSdk.start(listener);
```

需要把真实 JSON 放进 Android assets：

```text
nativeplugins/SkitPangleDrama/android/assets/SDK_Setting_5850994.json
```

当前仓库只有占位文件：

```text
nativeplugins/SkitPangleDrama/android/assets/SDK_Setting_5850994.json.placeholder
```

## 原生桥接口

前端调用：

```js
const plugin = uni.requireNativePlugin('SkitPangleDrama');
```

方法约定：

```js
plugin.start({ settingFile: 'SDK_Setting_5850994.json', debug: true }, callback);
plugin.list({ page: 1, count: 20, order: true }, callback);
plugin.categoryList({}, callback);
plugin.listWithCategory({ category: '甜宠', page: 1, count: 20 }, callback);
plugin.listWithIds({ ids: [123456] }, callback);
plugin.openPlayer({ dramaId: 123456, episode: 1, freeSet: 8, lockSet: 5 }, callback);
```

原生侧对应参考：

- `DPSdk.factory().requestAllDrama(...)`
- `DPSdk.factory().requestDramaCategoryList(...)`
- `DPSdk.factory().requestDramaByCategory(...)`
- `DPSdk.factory().requestDrama(...)`
- `DPSdk.factory().createDramaDetail(...)`

## Android 依赖

参考项目使用：

```gradle
implementation 'com.pangle.cn:ads-sdk-pro:5.3.0.5'
implementation('com.pangle.cn:pangrowth-sdk:3.9.0.0') {
    exclude group: 'com.pangle.cn', module: 'partner-live-sdk'
    exclude group: 'com.pangle.cn', module: 'pangrowth-novel-sdk'
    exclude group: 'com.pangle.cn', module: 'pangrowth-game-sdk'
    exclude group: 'com.pangle.cn', module: 'pangrowth-luckycat-sdk'
    exclude group: 'com.pangle.cn', module: 'pangrowth-reward-sdk'
    exclude group: 'com.pangle.cn', module: 'partner-luckycat-api-sdk'
    exclude group: 'com.pangle.cn', module: 'pangrowth-luckycat-api'
}
```

正式接入时以穿山甲后台接入工具生成的最新 SDK 版本为准。

## HBuilderX 打包要求

当前 `skit-saas-app` 不是完整 Android Gradle 离线工程，不能在这个仓库里直接编译真实短剧 SDK。可选路径：

1. HBuilderX 自定义基座 / 云打包：
   - 导入 `nativeplugins/SkitPangleDrama`。
   - 将本目录 Java 源编译成原生插件 AAR。
   - 放入真实 `SDK_Setting_5850994.json`。
2. uni-app Android 离线打包：
   - 建立完整 Android 工程。
   - 复制 `SkitPangleDramaModule` / `SkitPangleDramaActivity`。
   - 加入穿山甲短剧 SDK Maven 依赖和 assets JSON。

## 后台校验

真实包必须满足：

1. 包名和穿山甲后台应用包名一致。
2. SHA1 与后台配置一致。
3. `SDK_Setting_5850994.json` 与后台应用一致。
4. minSdkVersion 不低于 24。
5. 真机或正式自定义基座验证，普通 WebView 预览 APK 不包含该原生 SDK。
