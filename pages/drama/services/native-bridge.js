export function getNativePlugin(pluginName) {
  try {
    if (typeof uni === 'undefined' || typeof uni.requireNativePlugin !== 'function') {
      return null;
    }
    return uni.requireNativePlugin(pluginName);
  } catch (error) {
    return null;
  }
}

export function callNativeMethod(plugin, method, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;

  return new Promise((resolve, reject) => {
    if (!plugin || typeof plugin[method] !== 'function') {
      reject(new Error(`Native method unavailable: ${method}`));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Native method timeout: ${method}`));
      }
    }, timeoutMs);

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result || {});
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error || 'Native method failed')));
    }

    try {
      const result = plugin[method](payload, finish);
      if (result && typeof result.then === 'function') {
        result.then(finish).catch(fail);
      } else if (result !== undefined) {
        finish(result);
      }
    } catch (error) {
      fail(error);
    }
  });
}
