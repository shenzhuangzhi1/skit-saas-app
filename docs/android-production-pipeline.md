# Android production pipeline

The Android production artifact has one canonical mapping defined by `android-djx-runtime/production-profile.json`:

- package: `top.neoshen.xingheyingguan`
- Pangle site: `5850994`
- Pangle content app: `1037672`
- packaged content setting: `assets/SDK_Setting.json`
- Taku app: `a6a50ac83df403`
- Taku rewarded placement: `b6a50acf394505`
- artifact: `dist/xingheyingguan-release.apk`

`android-djx-runtime/build-djx-apk.sh` is the only production build entry. It rejects environment overrides that conflict with the profile, forces real SDK content, disables mock rewarded ads, rebuilds the uni-app frontend, and runs the APK verifier.

## CI secrets

The `Android production APK` workflow runs on a macOS self-hosted runner carrying the `hbuilderx` and `android` labels. Configure its `android-production` environment with:

- `PANGLE_SETTINGS_JSON_BASE64`
- `RELEASE_KEYSTORE_BASE64`
- `SKIT_API_BASE_URL` (HTTPS)
- `SKIT_TAKU_APP_KEY`
- `SKIT_RELEASE_STORE_PASSWORD`
- `SKIT_RELEASE_KEY_ALIAS`
- `SKIT_RELEASE_KEY_PASSWORD`

The Pangle settings JSON and signing key are protected inputs and must not be committed. The source-packaging workflow in `cicd.yml` is not allowed to create a production APK.

## Verification gates

`verify-production-apk.sh` fails the build unless all of the following are true:

1. APK package equals the production profile package.
2. Exactly one Pangle settings asset exists and the frontend references that exact name.
3. Pangle site ID, content app ID, and licensed package match the profile.
4. The APK contains both SDK classes and the exact Pangle/Taku versions from the profile.
5. The APK contains the profile's Taku app ID and rewarded placement ID.

Before store release, also gate rewards using consistent results from the client callback, the third-party ad platform server callback, and the Taku server callback. A client-only reward callback is suitable for integration testing, not production settlement.
