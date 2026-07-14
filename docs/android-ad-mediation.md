# Android 广告与短剧解锁架构

一期只有一条生产广告路径：Taku 是激励视频主控，穿山甲等平台作为 Taku ADN；DJX 只提供短剧内容和播放器。页面、DJX 和本地 Taku 奖励回调都没有解锁权，唯一授权事实是后端已验签奖励产生的逐集权益。

## 每租户广告身份

每个代理商绑定独立租户和独立白标 APK。APK 的 Taku AppID/AppKey、激励广告位、穿山甲 Setting/license、Android 包名和租户 ID 必须属于同一个代理商。Taku AppKey 和厂商要求随包发布的配置可被反编译，不能当作服务端凭据；奖励验签密钥、报表密钥和 callback key 只保存在后端/Secret Manager。

## 严格会话流程

1. App 使用会员登录态向后端创建广告会话；DJX 原生播放器只接收固定租户、会员和剧目的短时 `playerGrant`。
2. 后端返回版本化协议：`sessionId/provider/placementId/userId/customData/scene`。
3. 原生为该会话新建一个 `ATRewardVideoAd`，在 `load()` 前设置 `USER_ID` 与 `USER_CUSTOM_DATA`，展示时设置 `showCustomExt(sessionId)`。
4. 原生从 `ATAdInfo.getShowId()` 读取平台 `providerShowId`，按单调序号上报 LOADING/LOADED/SHOWING/ERROR/CLOSED；不预加载、不复用广告对象。
5. 客户端奖励仅是遥测。关闭后 App 查询后端；只有同一 `sessionId/providerShowId` 达到 `SIGNED_VERIFIED + GRANTED` 才向 DJX 回传成功。

本地 synthetic ID、`onRewardVerify(true)` fallback、GroMore 独立桥和本地已解锁集合均已禁止。断网或平台回调延迟时，用户看到“验证中/稍后重试”，不能用客户端回调绕过。

## WebView 与更新边界

原生 `JavascriptInterface` 只在进程内精确 `http://127.0.0.1:<port>` 顶层页面完成加载后挂载，每次调用和异步回调都会复核当前顶层 origin。任何外部 HTTP/HTTPS 顶层链接交给系统浏览器，外部页面永远不能持有 bridge。

WebView 热更新必须使用 APK 内置 RSA 公钥验证的七字段清单：`tenantId/applicationId/bundleUrl/bundleSha256/protocolVersion/releaseNo/signature`。原生同时校验 HTTPS、hash、租户/包名/协议和单调版本，拒绝无签名、错租户、重放与回滚。

## 构建与验证

- 日常 UI/业务更新：运行 `.github/workflows/hot-update.yml`，发布 zip 与签名 manifest。
- SDK、包名、广告主账号、license、原生协议或密钥更新：运行 `.github/workflows/android-production.yml` 发布新 APK。
- 本地回归：`npm run test:app`、`npm run check:identity`，再执行 Android `:app:testDebugUnitTest :app:assembleDebug`。
- 正式 APK 必须通过 `android-djx-runtime/verify-production-apk.sh` 的包名、SDK、租户、公钥、反回滚、非 debuggable 和固定签名证书检查。
