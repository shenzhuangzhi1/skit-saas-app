# 代理商白标 Android 构建

穿山甲和 Taku 的客户端主账号在原生 SDK 初始化时绑定，一个 APK 不能安全地在多个代理商
账号之间切换。因此，每个代理商必须使用独立、受版本控制的完整构建档案。

## 唯一入口

构建档案位于 `android-djx-runtime/profiles/<PROFILE_CODE>.json`。Actions 的
`profile_code` 只接受同名档案；解析器同时校验文件名、`profileCode` 和 `tenantId`，并拒绝
不同档案复用包名、穿山甲 site/content App、Taku App/广告位或产物名。

正式构建使用 `Android production APK`：

1. 输入 `profile_code`、递增的 Android `versionCode`、展示版本和基础 runtime releaseNo；
2. workflow 从仓库选择同名档案，输出档案版本和 SHA-256；
3. workflow 只读取 `android-production-<PROFILE_CODE>` Environment 中的 Secret；
4. 构建脚本再次解析同一档案，拒绝任何环境变量串用其他代理商的 SDK 身份；
5. APK 校验器核对包名、SDK 配置、租户、热更新公钥和签名证书。

本地构建也必须显式选择档案，不再存在全局 `production-profile.json` 兜底：

```bash
SKIT_PROFILE_CODE=AG162 \
SKIT_API_BASE_URL=https://api.example.com \
SKIT_PANGLE_SETTINGS_JSON=/secure/path/SDK_Setting.json \
SKIT_TAKU_APP_KEY='***' \
SKIT_BUILD_TYPE=debug \
bash android-djx-runtime/build-djx-apk.sh
```

正式包还必须注入版本号、至少 2048 位热更新 RSA 公钥、正式 keystore 和固定证书 SHA-256。
完整 Secret 清单见 `docs/android-production-pipeline.md`。

## 新增或更新代理商

新增时复制 `android-djx-runtime/profiles/AG162.json`，按
`android-djx-runtime/profiles/README.md` 改完所有原生身份，并新建对应 GitHub Environment。
更新包名、广告 SDK 身份、穿山甲 license、Taku 主账号或热更新公钥时，递增
`profileVersion` 后重新发 APK。普通 SaaS 后台、App 页面和业务逻辑更新不改 profile，使用
同一 `profile_code` 运行 `App hot update bundle` 即可。

## 密钥边界

构建档案中的 App ID、广告位和包名会进入 APK，不是后台身份凭据。Taku App Key、穿山甲
Setting 正文、APK 签名私钥、热更新私钥及密码只存在对应的 GitHub Environment。后台 App
Secret、S2S 回调验签密钥、报表 API Secret 和数据库加密主密钥绝不能进入 App workflow、
BuildConfig、资源文件或构建档案。
