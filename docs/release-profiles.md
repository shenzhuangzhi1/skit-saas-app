# Agent App release profiles

本文的 SaaS `skit_app_release_profile` 是已构建产物的发布元数据，不是 Android 原生构建
档案。原生包名和广告 SDK 身份由仓库中的
`android-djx-runtime/profiles/<PROFILE_CODE>.json` 管理；两者使用相同 `profileCode` 关联，
但后台发布表绝不保存构建 Secret。

Each agent has one public release profile, using its agent code as `profileCode`. The profile is stored by the SaaS backend in `skit_app_release_profile` and contains only delivery data:

- `channel`, `minNativeVersion`, `hotVersion`
- signed manifest scope: `tenantId`, `applicationId`, `protocolVersion`, monotonic `releaseNo`
- public HTTPS bundle URL, `bundleSha256`, and RSA `signature`
- native package/version for operator reference

It must never contain Pangle JSON, Taku keys, signing keys, passwords, private URLs, or provider credentials. Run `node script/validate-release-profile.mjs --fixture script/fixtures/release-profile-valid.json` before entering release metadata.

## Ordinary SaaS update

Deploy backend and web admin once. For an App UI/business update, run **App hot update bundle** with the agent profile code, display version, monotonic release number, and final HTTPS URL. It builds that agent's WebView bundle and publishes both the zip and its signed manifest. Upload the zip to that exact HTTPS location, then import the manifest fields and set the display/minimum versions on that agent's release profile. Do not manually re-sign or reconstruct the manifest in the backend.

The App checks the manifest after startup. Its native bridge verifies the embedded-public-key signature and exact tenant/application/protocol scope before download, rejects release replay or rollback, downloads only over HTTPS, verifies SHA-256, prevents zip path traversal, and activates only after complete extraction. The highest accepted release is persisted in App-private storage. A failed update keeps the current UI bundle active.

## Native update exception

Pangle and Taku SDK identities, Pangle license package bindings, signing keys, and Android package names are native inputs. Changing any of them requires a selected agent's signed APK build through **Android production APK**; a hot bundle cannot and must not alter them.

The same rule applies to the locked mediation bundle. Taku core/adapter or Pangle-GroMore SDK upgrades require a reviewed profileVersion increment, a new native APK, source/APK lock verification, duplicate-class checking, and the reusable package gate when configured. Provider network/adsource selection remains server-side and must never be added to a release profile.
