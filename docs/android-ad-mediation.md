# Android 广告与短剧解锁架构

App 只有一个统一激励广告入口：业务代码始终调用 Taku `ATRewardVideoAd`，由 Taku 服务端策略在锁定的 ADX、百度、优量汇、快手和 GroMore 适配器中动态选择广告源。App 不硬编码网络或 adsource，也没有任何直连供应商的激励广告路径。穿山甲 DJX 负责短剧内容和播放器；页面、DJX 和本地 Taku 奖励回调都没有解锁权，唯一授权事实是后端已验签奖励产生的逐集权益。

SDK 包固定为官方 Taku 6.6.30 中国区 ZIP 的 13 个 AAR，其中 GroMore 使用同包的 CSJ mix、mobrain mix plus 与 `open_ad_sdk_7.6.1.1.aar`。`taku-adapter-bundle.lock.json` 锁定全部 AAR、嵌套 jar、类/DEX 标记、组件、资源和 native library；源码构建与 APK 验证都要求 `TTAdSdk` 恰好一份。Gradle 不排除、不 `pickFirst` 重复类；如 Maven 再引入 `mediation-sdk`，依赖契约会直接失败。

## 每租户广告身份

每个代理商绑定独立租户和独立白标 APK。APK 的 Taku AppID/AppKey、激励广告位、穿山甲 Setting/license、Android 包名和租户 ID 必须属于同一个代理商。Taku AppKey 和厂商要求随包发布的配置可被反编译，不能当作服务端凭据；奖励验签密钥、报表密钥和 callback key 只保存在后端/Secret Manager。

## 严格会话流程

1. App 使用会员登录态向后端创建广告会话；DJX 原生播放器只接收固定租户、会员和剧目的短时 `playerGrant`。
2. 后端返回版本化协议：`sessionId/provider/placementId/userId/customData/scene`。
3. 原生为该会话新建一个 Taku `ATRewardVideoAd`，在 `load()` 前设置 `USER_ID` 与 `USER_CUSTOM_DATA`，展示时设置 `showCustomExt(sessionId)`。
4. 原生从 `ATAdInfo` 动态读取 `providerShowId/networkFirmId/adsourceId`，按单调序号上报 LOADING/LOADED/SHOWING/ERROR/CLOSED；源码日志只保留 `networkFirmId` 和不可逆 `adsourceAlias`，不记录原始 adsource 或供应商错误描述。
5. 客户端奖励仅是遥测。关闭后 App 查询后端；只有同一 `sessionId/providerShowId` 达到 `SIGNED_VERIFIED + GRANTED` 才向 DJX 回传成功。

本地 synthetic ID、`onRewardVerify(true)` fallback、GroMore 独立桥和本地已解锁集合均已禁止。断网或平台回调延迟时，用户看到“验证中/稍后重试”，不能用客户端回调绕过。

## 隐私同意与初始化顺序

第三方 SDK 默认处于 UNKNOWN，Pangle/Taku 都不会初始化。H5 在首次真实内容启动或锁定剧集解锁前展示明确的隐私与广告 SDK 弹窗；拒绝时不创建广告会话且剧集保持锁定。接受记录按白标构建 `profileCode` 保存 `consentVersion` 与时间戳，并在 WebView/进程重启后重新通过受信任的 `PRIVACY` bridge 交付原生。原生只接受 `{granted: boolean, consentVersion: 1}`。

内容优先和广告优先都执行同一顺序：先初始化 Pangle/GroMore 的全局 `TTAdSdk` 身份，再初始化 Taku。进程级 ownership 状态只在本 App 的 `init` 被接受且 `start` 成功后记录；如首次检查时全局 `TTAdSdk` 已 ready 却没有该 ownership，立即 fail closed，Activity 重建只能复用先前受控成功。UNKNOWN 请求会立即返回稳定的 consent-required 错误，由 H5 弹窗后重试，不会悬挂等待。

原生 bootstrap 失败只通过受信任、回调级、不可枚举的 hint 暴露 `PRIVACY_CONSENT_REQUIRED`、`PANGLE_INIT_FAILED` 或 `TAKU_INIT_FAILED`。H5 将其映射为稳定错误码和用户文案；严格的 11 字段客户端遥测及后端 `FAILED` 事件不增加供应商描述或 UI-only 字段，no-fill 也不会与初始化失败混淆。

## WebView 与更新边界

原生 capability 只通过 origin-aware WebMessage channel 暴露给进程内精确 `http://127.0.0.1:<port>` 顶层页面，每次调用和异步回调都会复核当前顶层 origin。任何外部 HTTP/HTTPS 顶层链接交给系统浏览器，外部页面永远不能持有 bridge。

WebView 热更新必须使用 APK 内置 RSA 公钥验证的七字段清单：`tenantId/applicationId/bundleUrl/bundleSha256/protocolVersion/releaseNo/signature`。原生同时校验 HTTPS、hash、租户/包名/协议和单调版本，拒绝无签名、错租户、重放与回滚。

## 构建与验证

- 日常 UI/业务更新：运行 `.github/workflows/hot-update.yml`，发布 zip 与签名 manifest。
- SDK、包名、广告主账号、license、原生协议或密钥更新：运行 `.github/workflows/android-production.yml` 发布新 APK。
- 本地回归：`npm run test:app`、`npm run check:identity`、源码 bundle verifier，再执行 Android `:app:checkDebugDuplicateClasses :app:testDebugUnitTest :app:assembleDebug`。

## 本地 push 前验证

在 macOS 上安装 Node.js、Java 17、Android SDK 和 Gradle 8.10.2 后，执行：

```bash
./scripts/install-local-hooks.sh
./scripts/verify-local.sh
```

验证会检查 App 元数据、成员身份边界、广告会话测试，并构建仅供本地测试的
Android debug APK；不会创建生产签名包，也不会上传任何构建产物。仓库没有
package-lock.json 时会使用 npm install，不会伪造锁文件。
- 正式 APK 必须通过 `android-djx-runtime/verify-production-apk.sh` 的包名、SDK、租户、公钥、反回滚、非 debuggable 和固定签名证书检查。
- 需要复用个人 package gate 时，设置 `SKIT_REUSABLE_PACKAGE_GATE=/absolute/path/to/verify-agent-apk.sh`；`build-djx-apk.sh` 会通过 `run-reusable-package-gate.sh` 传入 project/profile/APK。该调用不能替代项目 verifier。
