import AppReleaseApi from '@/sheep/api/app/release';

const SCOPE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

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

export function normalizeSignedManifest(manifest, runtime) {
  const tenantId = String(manifest?.tenantId || '');
  const applicationId = String(manifest?.applicationId || '');
  const bundleUrl = String(manifest?.bundleUrl || '');
  const bundleSha256 = String(manifest?.bundleSha256 || '').toLowerCase();
  const protocolVersion = Number(manifest?.protocolVersion);
  const releaseNo = Number(manifest?.releaseNo);
  const signature = String(manifest?.signature || '');
  const highestAcceptedRelease = Number(runtime?.highestAcceptedRelease);

  if (
    manifest?.updateAvailable !== true ||
    !runtime?.updatesEnabled ||
    !SCOPE_PATTERN.test(tenantId) ||
    !SCOPE_PATTERN.test(applicationId) ||
    tenantId !== runtime.tenantId ||
    applicationId !== runtime.applicationId ||
    !/^https:\/\//i.test(bundleUrl) ||
    !SHA256_PATTERN.test(bundleSha256) ||
    !Number.isSafeInteger(protocolVersion) ||
    protocolVersion <= 0 ||
    protocolVersion !== Number(runtime.protocolVersion) ||
    !Number.isSafeInteger(releaseNo) ||
    releaseNo <= 0 ||
    !Number.isSafeInteger(highestAcceptedRelease) ||
    releaseNo <= highestAcceptedRelease ||
    signature.length < 344 ||
    signature.length > 1024 ||
    signature.length % 4 !== 0 ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    throw new Error('服务端热更新签名清单不完整或与当前 App 不匹配');
  }

  return Object.freeze({
    tenantId,
    applicationId,
    bundleUrl,
    bundleSha256,
    protocolVersion,
    releaseNo,
    signature,
  });
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
  if (!nativeVersion || !runtime.updatesEnabled) {
    return { skipped: true };
  }
  const result = await AppReleaseApi.current({
    profileCode: normalizedProfileCode,
    nativeVersion,
  });
  if (result?.code !== 0 || result?.data?.updateAvailable !== true) {
    return { skipped: true };
  }
  const manifest = normalizeSignedManifest(result.data, runtime);
  const installResult = await invoke(plugin, 'installWebBundle', manifest);
  if (Number(installResult.releaseNo) !== manifest.releaseNo) {
    throw new Error('原生运行时返回了不匹配的热更新版本');
  }

  // Native bridge atomically activates the verified bundle; reload only after that succeeds.
  if (typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
  return {
    installed: true,
    hotVersion: result.data.hotVersion,
    releaseNo: manifest.releaseNo,
  };
}
