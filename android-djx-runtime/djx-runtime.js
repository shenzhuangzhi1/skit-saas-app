(function () {
  function installNativePluginBridge() {
    if (!window.uni || window.uni.__skitDjxBridgeInstalled) return;

    var callbacks = {};
    var failureHints = {};
    var sequence = 1;

    window.__SkitNativeBridgeFailureHint = function (id, reason) {
      if (!callbacks[id]) return;
      if (reason !== 'NO_FILL' && reason !== 'SDK_FAILURE') return;
      failureHints[id] = reason;
    };

    window.__SkitNativeBridgeEmit = function (id, rawResult, terminal) {
      var callback = callbacks[id];
      if (!callback) return;
      var result = {};
      try {
        result = rawResult ? JSON.parse(rawResult) : {};
      } catch (error) {
        result = { success: false, message: String(error || 'Native result parse failed') };
      }
      var failureHint = failureHints[id];
      if (terminal === true) delete failureHints[id];
      if (
        terminal === true &&
        result.nativeState === 'ERROR' &&
        (failureHint === 'NO_FILL' || failureHint === 'SDK_FAILURE')
      ) {
        Object.defineProperty(result, 'failureReason', {
          value: failureHint,
          enumerable: false,
          configurable: false,
          writable: false,
        });
      }
      try {
        callback(result);
      } finally {
        if (terminal === true) {
          delete callbacks[id];
          delete failureHints[id];
        }
      }
    };

    window.__SkitNativeBridgeResolve = function (id, rawResult) {
      window.__SkitNativeBridgeEmit(id, rawResult, true);
    };

    function callNative(bridge, nativeName, method, payload, callback) {
      if (!window.SkitNativeBridge || typeof window.SkitNativeBridge.postMessage !== 'function') {
        if (typeof callback === 'function') {
          callback({ success: false, message: nativeName + ' missing' });
        }
        return;
      }
      var id = 'djx_' + Date.now() + '_' + sequence++;
      delete failureHints[id];
      callbacks[id] = typeof callback === 'function' ? callback : function () {};
      window.SkitNativeBridge.postMessage(
        JSON.stringify({
          bridge: bridge,
          id: id,
          method: method,
          payload: payload || {},
        }),
      );
    }

    function callPangle(method, payload, callback) {
      callNative('PANGLE', 'SkitPangleDrama', method, payload, callback);
    }

    function callTaku(method, payload, callback) {
      callNative('TAKU', 'SkitTakuAd', method, payload, callback);
    }

    function callRuntimeUpdate(method, payload, callback) {
      callNative('RUNTIME_UPDATE', 'SkitRuntimeUpdate', method, payload, callback);
    }

    var originalRequire = window.uni.requireNativePlugin;
    window.uni.requireNativePlugin = function (name) {
      if (name === 'SkitPangleDrama') {
        return {
          start: function (payload, callback) {
            callPangle('start', payload, callback);
          },
          list: function (payload, callback) {
            callPangle('list', payload, callback);
          },
          recommend: function (payload, callback) {
            callPangle('recommend', payload, callback);
          },
          history: function (payload, callback) {
            callPangle('history', payload, callback);
          },
          categoryList: function (payload, callback) {
            callPangle('categoryList', payload, callback);
          },
          listWithCategory: function (payload, callback) {
            callPangle('listWithCategory', payload, callback);
          },
          search: function (payload, callback) {
            callPangle('search', payload, callback);
          },
          listWithIds: function (payload, callback) {
            callPangle('listWithIds', payload, callback);
          },
          openPlayer: function (payload, callback) {
            callPangle('openPlayer', payload, callback);
          },
        };
      }
      if (name === 'SkitTakuAd') {
        return {
          showRewardedVideo: function (payload, callback) {
            callTaku('showRewardedVideo', payload, callback);
          },
          cancelRewardedVideo: function (payload, callback) {
            callTaku('cancelRewardedVideo', payload, callback);
          },
        };
      }
      if (name === 'SkitRuntimeUpdate') {
        return {
          getInfo: function (payload, callback) {
            callRuntimeUpdate('getInfo', payload, callback);
          },
          installWebBundle: function (payload, callback) {
            callRuntimeUpdate('installWebBundle', payload, callback);
          },
        };
      }
      return typeof originalRequire === 'function' ? originalRequire(name) : null;
    };

    window.uni.__skitDjxBridgeInstalled = true;
    console.log('[skit-djx] native DJX bridge installed');
  }

  function tick() {
    installNativePluginBridge();
  }

  setInterval(tick, 300);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
})();
