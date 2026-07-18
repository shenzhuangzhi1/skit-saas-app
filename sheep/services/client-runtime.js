const NATIVE_VERSION_PATTERN = /^[0-9]{1,9}(\.[0-9]{1,9}){1,3}([-.][A-Za-z0-9._-]{1,32})?$/;

function getNativeRuntimePlugin() {
  if (typeof uni === 'undefined' || typeof uni.requireNativePlugin !== 'function') {
    return null;
  }
  return uni.requireNativePlugin('SkitRuntimeUpdate');
}

function normalizeRuntimeInfo(result) {
  const nativeVersion = String(result?.nativeVersion || '').trim();
  const protocolVersion = Number(result?.protocolVersion);
  if (
    result?.success !== true ||
    !NATIVE_VERSION_PATTERN.test(nativeVersion) ||
    !Number.isSafeInteger(protocolVersion) ||
    protocolVersion <= 0
  ) {
    return null;
  }
  return Object.freeze({ nativeVersion, protocolVersion });
}

export function createClientRuntimeProvider(pluginFactory = getNativeRuntimePlugin) {
  let runtimePromise;

  return () => {
    if (runtimePromise) {
      return runtimePromise;
    }

    runtimePromise = new Promise((resolve) => {
      let settled = false;
      let timeout;

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(normalizeRuntimeInfo(result));
      };

      let plugin;
      try {
        plugin = pluginFactory();
      } catch (error) {
        finish(null);
        return;
      }

      if (!plugin || typeof plugin.getInfo !== 'function') {
        finish(null);
        return;
      }

      timeout = setTimeout(() => finish(null), 1500);
      timeout.unref?.();
      try {
        plugin.getInfo({}, finish);
      } catch (error) {
        finish(null);
      }
    });

    return runtimePromise.then((runtime) => {
      // The bridge script may load after the first protected API request.
      // Cache only a verified native runtime so a later request can retry discovery.
      if (!runtime) {
        runtimePromise = null;
      }
      return runtime;
    });
  };
}

export function buildClientRuntimeHeaders(runtime) {
  const normalized = normalizeRuntimeInfo({ success: true, ...runtime });
  if (!normalized) {
    return {};
  }
  return {
    'X-Skit-Native-Version': normalized.nativeVersion,
    'X-Skit-Ad-Protocol-Version': String(normalized.protocolVersion),
  };
}

export const getClientRuntimeInfo = createClientRuntimeProvider();
