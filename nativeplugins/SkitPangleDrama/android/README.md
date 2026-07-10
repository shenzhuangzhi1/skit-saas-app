# SkitPangleDrama Android 原生插件

这个目录是穿山甲短剧内容 SDK 的 uni-app 原生桥接骨架。

## 必要文件

1. 从穿山甲短剧后台下载 Android SDK 配置 JSON。
2. 将配置文件放入 Android assets，默认文件名：

```text
SDK_Setting_5850994.json
```

3. 依赖穿山甲短剧 SDK：

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

如果穿山甲后台下载页给出更新版本，以后台生成的 SDK 版本为准。

## JS 暴露方法

插件名：

```text
SkitPangleDrama
```

方法：

```js
start({ settingFile, debug }, callback)
list({ page, count, order }, callback)
categoryList({}, callback)
listWithCategory({ category, page, count }, callback)
listWithIds({ ids }, callback)
openPlayer({ dramaId, episode, freeSet, lockSet, progress }, callback)
```

## 当前接入策略

移动端页面通过 `pages/drama/services/pangle-content.js` 调用本插件：

- 首页 / 剧场：优先使用 `list` 拉取真实穿山甲短剧列表。
- 播放页：用 `openPlayer` 打开穿山甲短剧原生播放器。
- 解锁：仍由页面层的 GroMore/Taku 激励广告控制，完整观看后才允许进入锁定集。

当前仓库的 WebView 预览 APK 不包含本原生 SDK，只能验证 UI 和广告回调占位。真实短剧播放必须通过 HBuilderX 自定义基座/云打包或 Android 离线打包工程验证。
