# Agent App release profiles

Each agent has one public release profile, using its agent code as `profileCode`. The profile is stored by the SaaS backend in `skit_app_release_profile` and contains only delivery data:

- `channel`, `minNativeVersion`, `hotVersion`
- public HTTPS bundle URL and SHA-256
- native package/version for operator reference

It must never contain Pangle JSON, Taku keys, signing keys, passwords, private URLs, or provider credentials. Run `node script/validate-release-profile.mjs --fixture script/fixtures/release-profile-valid.json` before entering release metadata.

## Ordinary SaaS update

Deploy backend and web admin once. For an App UI/business update, run **App hot update bundle** with the agent profile code and version. It builds that agent's WebView bundle, validates the embedded agent code, and publishes an artifact plus SHA-256. Upload the artifact to the configured public HTTPS update host, then set the artifact URL, checksum, hot version, and minimum native version on that agent's release profile.

The App checks the manifest after startup. Its native bridge downloads the archive only over HTTPS, verifies SHA-256 before extraction, prevents zip path traversal, and activates it only after a complete successful extraction. A failed update keeps the current UI bundle active.

## Native update exception

Pangle and Taku SDK identities, Pangle license package bindings, signing keys, and Android package names are native inputs. Changing any of them requires a selected agent's signed APK build through **Android production APK**; a hot bundle cannot and must not alter them.
