# SkitPangleDrama Android 原生插件

这个目录是穿山甲短剧内容 SDK 的 uni-app 原生桥接。

## 当前配置

已接入的 SDK 参数配置：

```text
android/assets/SDK_Setting_5850994.json
```

这份配置文件校验到的信息：

```text
site_id: 5850994
app_id: 1037672
license_config.PackageName: top.neoshen.xingheyingguan
```

正式 APK 的 Android 包名必须是 `top.neoshen.xingheyingguan`，否则内容 SDK license 会不匹配。需要先在穿山甲内容输出后台录入该包名并重新下载 SDK 参数配置。

## Maven 仓库

```gradle
maven { url 'https://artifact.bytedance.com/repository/Volcengine/' }
maven { url 'https://artifact.bytedance.com/repository/pangle' }
```

## Android 依赖

以穿山甲接入文档/后台生成命令为准，当前按用户提供版本接入：

```gradle
implementation 'com.pangle_beta.cn:mediation-sdk:7.1.0.5'
implementation 'com.pangle.cn:pangrowth-base:2.9.0.9'
implementation 'com.pangle.cn:pangrowth-djx-sdk-lite:2.9.0.9'
```

`pangrowth-base` 和 `pangrowth-djx-sdk-lite` 在 Volcengine Maven 仓库下；`mediation-sdk` 在 pangle Maven 仓库下。

## JS 暴露方法

插件名：

```text
SkitPangleDrama
```

方法：

```js
start({ settingFile, debug }, callback)
list({ page, count, order }, callback)
recommend({ page, count }, callback)
history({ page, count }, callback)
categoryList({}, callback)
listWithCategory({ category, categoryId, page, count }, callback)
search({ keyword, page, count }, callback)
listWithIds({ ids }, callback)
openPlayer({ dramaId, episode, freeSet, lockSet, progress }, callback)
```

## 原生实现

当前桥接使用新版 DJX API：

```java
DJXSdk.init(context, "SDK_Setting_5850994.json", config);
DJXSdk.start(listener);
DJXSdk.service().requestAllDrama(...);
DJXSdk.service().requestDramaCategoryList(...);
DJXSdk.service().requestDramaByCategory(...);
DJXSdk.service().requestDrama(...);
DJXSdk.factory().createDramaDetail(...);
```

移动端页面通过 `pages/drama/services/pangle-content.js` 调用本插件：

- 首页 / 剧场：优先使用 `list` 拉取真实穿山甲短剧列表。
- 播放页：用 `openPlayer` 打开穿山甲短剧原生播放器。
- 解锁：页面先向服务端创建一次性广告会话，再由 Taku 原生桥按该会话加载和展示广告；客户端回调只上报过程，必须等服务端签名奖励回调生成权益后才能播放付费剧集。GroMore 与本地兜底解锁均已移除。

当前仓库的 WebView 预览 APK 不包含本原生 SDK，只能验证 UI 和广告回调占位。真实短剧播放必须通过 HBuilderX 自定义基座/云打包或 Android 离线打包工程验证。
