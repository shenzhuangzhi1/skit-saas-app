# Android production pipeline

Android 生产包由 `android-djx-runtime/profiles/<PROFILE_CODE>.json` 一对一描述。档案采用
`schemaVersion: 2`，每次原生身份或 SDK 配置变化必须递增 `profileVersion`。仓库不再提供
全局 production profile，也不允许仅替换 tenantId 后复用另一代理商的广告 SDK 配置。

当前档案 `XINGHEYINGGUAN` 映射包名、穿山甲 site/content App、Taku App/激励广告位以及
唯一产物名。后续代理商按 `android-djx-runtime/profiles/README.md` 新增同名档案。

## 每个 profile 的 GitHub Environment

为每个档案创建 `android-production-<PROFILE_CODE>` Environment。环境名称由 workflow 的
输入直接选择；档案解析失败时构建立即停止。每个 Environment 独立配置：

Secrets：

- `PANGLE_SETTINGS_JSON_BASE64`
- `RELEASE_KEYSTORE_BASE64`
- `SKIT_API_BASE_URL`（HTTPS）
- `SKIT_TAKU_APP_KEY`
- `SKIT_RELEASE_STORE_PASSWORD`
- `SKIT_RELEASE_KEY_ALIAS`
- `SKIT_RELEASE_KEY_PASSWORD`
- `RUNTIME_UPDATE_SIGNING_KEY_BASE64`

非 Secret 变量：

- `SKIT_RUNTIME_UPDATE_PUBLIC_KEY`（至少 2048 位 RSA X.509 DER 的 base64）
- `SKIT_RUNTIME_PROTOCOL_VERSION`
- `SKIT_RELEASE_CERT_SHA256`

包名、tenant、穿山甲 App、Taku App 和广告位不再复制到 GitHub vars，它们只从受代码审查
的同名档案解析，避免 Environment 变量与档案交叉拼装。私钥和密码绝不写进档案。

## 发布流程

1. 原生更新：运行 **Android production APK**，输入同名 `profile_code`、递增的
   `native_version_code`、`native_version_name` 和 `runtime_release_no`。
2. 普通 App 页面/业务更新：运行 **App hot update bundle**，输入同一 `profile_code`、
   展示版本、严格递增的 releaseNo 和最终 HTTPS zip 地址。
3. SaaS 后台更新只部署 backend/web；不需要重打代理商 APK。

两个 workflow 都使用 `android-production-<PROFILE_CODE>`，因此 APK keystore、Taku Key 和
热更新签名私钥按代理商隔离。解析步骤把档案版本和 SHA-256 写入日志/产物名，便于审计。

## Verification gates

`build-djx-apk.sh` 和 `verify-production-apk.sh` 均要求显式 `SKIT_PROFILE_CODE`，并重新验证：

1. 输入 code、档案文件名、`profileCode`、`tenantId` 完全相同；
2. 所有档案的 tenant、包名、穿山甲与 Taku 身份全局唯一；
3. APK 包名和唯一 Setting asset 与档案一致，Setting license 覆盖该包名；
4. APK 包含档案要求的 SDK 版本、Taku App/广告位和准确租户；
5. 热更新公钥、protocol、anti-rollback floor、Android 版本与 release 输入一致；
6. APK 非 debug、只有一个 signer，签名证书匹配固定 SHA-256；
7. WebView bundle 不含本地广告奖励兜底。

热更新私钥和 Android keystore 是两套独立凭据。轮换任一凭据都通过经审计的原生发布，
不得将私钥放入仓库、release profile、App bundle 或后台接口。
