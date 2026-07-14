# Android 代理商构建档案

每个代理商只有一个受控构建档案，文件名必须是 `<PROFILE_CODE>.json`，且文件内
`profileCode`、`tenantId` 必须与文件名完全一致。`PROFILE_CODE` 使用 3～32 位大写字母、
数字、下划线或短横线；手机号租户可直接使用手机号作为 code。

新增代理商 App：

1. 复制 `XINGHEYINGGUAN.json` 为新的 `<PROFILE_CODE>.json`。
2. 将 `profileVersion` 从 `1` 开始；以后任何原生身份或 SDK 配置变化都递增它。
3. 修改包名、穿山甲 site/content App、Setting 来源、Taku App/广告位和产物名。解析器会拒绝
   不同档案复用租户、包名、穿山甲账号、Taku 账号或产物名。
4. 在 GitHub 新建同名 Environment：`android-production-<PROFILE_CODE>`，配置该代理商独立的
   Secret 和变量。
5. 本地运行
   `node android-djx-runtime/resolve-build-profile.mjs --profile-code <PROFILE_CODE> --format json`
   校验后提交。然后在 Actions 中运行 `Android production APK`，输入完全相同的 code。

档案只保存会被打进 APK 的公开身份，不保存 Taku App Key、穿山甲 Setting 正文、APK
签名私钥、热更新私钥、密码或后台广告平台 Secret。Secret 只进入该 profile 对应的 GitHub
Environment。更新普通页面/业务逻辑无需改档案，直接运行该 profile 的热更新 workflow。
