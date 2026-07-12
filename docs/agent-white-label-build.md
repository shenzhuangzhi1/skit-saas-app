# 代理商白标 Android 构建

穿山甲和 Taku 的客户端主账号都在原生 SDK 初始化时绑定。一个已启动的 APK 不能安全地在多个代理商主账号之间热切换，因此每个代理商必须使用独立包名和该代理商自己的 SDK 配置构建白标包。

## 构建参数

在 CI 的 Secret/secure file 中提供以下环境变量，再运行 `android-djx-runtime/build-djx-apk.sh`：

```bash
SKIT_AGENT_CODE=agent_demo \
SKIT_DRAMA_AD_PROVIDER=taku \
SKIT_APPLICATION_ID=com.example.agentdemo \
SKIT_APP_NAME='代理商短剧' \
SKIT_API_BASE_URL=https://api.example.com \
SKIT_PANGLE_APP_ID=0000000 \
SKIT_PANGLE_SETTINGS_JSON=/secure/path/SDK_Setting.json \
SKIT_TAKU_APP_ID=your-client-app-id \
SKIT_TAKU_APP_KEY=your-client-app-key \
SKIT_TAKU_REWARD_PLACEMENT_ID=your-placement-id \
SKIT_BUILD_TYPE=release \
SKIT_RELEASE_STORE_FILE=/secure/path/release.keystore \
SKIT_RELEASE_STORE_PASSWORD='***' \
SKIT_RELEASE_KEY_ALIAS=release \
SKIT_RELEASE_KEY_PASSWORD='***' \
bash android-djx-runtime/build-djx-apk.sh
```

构建脚本会执行以下硬校验：

- 生产 API 必须使用 HTTPS；
- 主广告平台必须明确为 `pangle` 或 `taku`，并与后台启用账号一致；
- 穿山甲 Setting 的 `init.site_id` 必须等于本次 App ID；
- Setting 的 license 必须覆盖本次 Android 包名；
- APK 中必须且只能存在一个 `assets/SDK_Setting.json`。

`SKIT_AGENT_CODE` 必须与后台代理商编码一致。App 会在展示广告前同时核对代理商编码和 SDK App ID，避免用户在错误的白标包中加载另一个代理商的广告位。

## 密钥边界

客户端 App ID、广告位、Taku 客户端 App Key，以及厂商要求随包发布的 Setting/license 都可被反编译，不能用作服务端身份凭据。

后台 App Secret、S2S 回调验签密钥、报表 API Secret、数据库加密主密钥和 APK 签名私钥绝不能写入 BuildConfig、资源文件、Setting 生成脚本或 App 接口。它们只能保存在后端 Secret Manager/CI Secret 中。

正式发布时还需通过 `SKIT_RELEASE_STORE_FILE`、`SKIT_RELEASE_STORE_PASSWORD`、`SKIT_RELEASE_KEY_ALIAS`、`SKIT_RELEASE_KEY_PASSWORD` 注入独立签名配置；不得复用仓库中的 debug keystore。
