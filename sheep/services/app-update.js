import AppReleaseApi from '@/sheep/api/app/release';
import safeUni from '@/sheep/helper/uni';

const INSTALLED_VERSION_KEY = 'skit-installed-hot-update';

function getRuntimePlugin() {
  if (typeof uni === 'undefined' || typeof uni.requireNativePlugin !== 'function') {
    return null;
  }
  return uni.requireNativePlugin('SkitRuntimeUpdate');
}

function invoke(plugin, method, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!plugin || typeof plugin[method] !== 'function') {
      reject(new Error('当前 App 运行时不支持热更新'));
      return;
    }
    plugin[method](payload, (result = {}) => {
      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.message || '热更新执行失败'));
      }
    });
  });
}

function isSafeManifest(manifest) {
  return (
    manifest?.updateAvailable === true &&
    /^https:\/\//i.test(String(manifest.bundleUrl || '')) &&
    /^[a-f0-9]{64}$/i.test(String(manifest.sha256 || '')) &&
    !!manifest.hotVersion
  );
}

export async function checkAndInstallUpdate({ profileCode } = {}) {
  const normalizedProfileCode = String(profileCode || '')
    .trim()
    .toUpperCase();
  const plugin = getRuntimePlugin();
  if (!normalizedProfileCode || !plugin) {
    return { skipped: true };
  }

  const runtime = await invoke(plugin, 'getInfo');
  const nativeVersion = String(runtime.nativeVersion || '').trim();
  if (!nativeVersion) {
    return { skipped: true };
  }
  const result = await AppReleaseApi.current({
    profileCode: normalizedProfileCode,
    nativeVersion,
  });
  const manifest = result?.data;
  if (result?.code !== 0 || !isSafeManifest(manifest)) {
    return { skipped: true };
  }

  const installed = safeUni.getStorageSync(INSTALLED_VERSION_KEY) || {};
  if (
    installed.profileCode === normalizedProfileCode &&
    installed.hotVersion === manifest.hotVersion
  ) {
    return { skipped: true };
  }

  await invoke(plugin, 'installWebBundle', {
    bundleUrl: manifest.bundleUrl,
    sha256: String(manifest.sha256).toLowerCase(),
  });
  safeUni.setStorageSync(INSTALLED_VERSION_KEY, {
    profileCode: normalizedProfileCode,
    hotVersion: manifest.hotVersion,
  });

  // Native bridge atomically activates the verified bundle; reload only after that succeeds.
  if (typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
  return { installed: true, hotVersion: manifest.hotVersion };
}
