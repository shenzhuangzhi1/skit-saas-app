# Skit SaaS App releases

The repository has three independent release paths so ordinary SaaS changes do not require a new APK.

## Ordinary source changes

A push to `master` runs the member-identity and server-verified-ad contract tests, then compiles and tests the Android debug runtime with Gradle 8.10.2. If the server SSH secrets are configured, the same workflow publishes a versioned source snapshot and atomically updates:

`skit-saas/app-source/current`

This path does not change the production APK or activate a hot update.

## WebView hot update

Run **App hot update bundle** with the agent profile code, semantic hot version, a strictly increasing release number, and the final HTTPS bundle URL. The workflow builds the H5 bundle, rejects local reward fallbacks, signs the tenant/application/SHA/protocol/release scope with the protected RSA key, and publishes the ZIP plus manifest as one Actions artifact.

Publish the ZIP at the exact signed HTTPS URL, then import the manifest fields in **短剧 SaaS → 用户管理 → App 发布** for that agent. The backend verifies the same RSA signature and monotonic release number before enabling it. A hot update never restarts the SaaS backend.

## New base APK

Run **Android production APK** only for native SDK, trust-root, permission, or minimum-protocol changes. It requires the protected Pangle settings, Taku key, release keystore, certificate fingerprint, API URL, runtime public key, and monotonic Android/runtime version inputs. The workflow builds exactly one signed production APK and verifies its identity and embedded security boundary before uploading the artifact.

Keep rollout `OFF` until the tenant-specific Taku callbacks, reporting access, dedicated reward placement, signed hot manifest, and production APK are all verified by the backend readiness checklist.
