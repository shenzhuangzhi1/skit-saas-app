(function () {
  function installNativePluginBridge() {
    if (!window.uni || window.uni.__skitDjxBridgeInstalled) return;

    var callbacks = {};
    var sequence = 1;

    window.__SkitNativeBridgeEmit = function (id, rawResult, terminal) {
      var callback = callbacks[id];
      if (!callback) return;
      var result = {};
      try {
        result = rawResult ? JSON.parse(rawResult) : {};
      } catch (error) {
        result = { success: false, message: String(error || 'Native result parse failed') };
      }
      try {
        callback(result);
      } finally {
        if (terminal === true) delete callbacks[id];
      }
    };

    window.__SkitNativeBridgeResolve = function (id, rawResult) {
      window.__SkitNativeBridgeEmit(id, rawResult, true);
    };

    function callNative(nativeBridge, nativeName, method, payload, callback) {
      if (!nativeBridge || typeof nativeBridge.postMessage !== 'function') {
        if (typeof callback === 'function') {
          callback({ success: false, message: nativeName + ' missing' });
        }
        return;
      }
      var id = 'djx_' + Date.now() + '_' + sequence++;
      callbacks[id] = typeof callback === 'function' ? callback : function () {};
      nativeBridge.postMessage(JSON.stringify({
        id: id,
        method: method,
        payload: payload || {},
      }));
    }

    function callPangle(method, payload, callback) {
      callNative(window.SkitPangleDramaNative, 'SkitPangleDramaNative', method, payload, callback);
    }

    function callTaku(method, payload, callback) {
      callNative(window.SkitTakuAdNative, 'SkitTakuAdNative', method, payload, callback);
    }

    function callRuntimeUpdate(method, payload, callback) {
      callNative(window.SkitRuntimeUpdateNative, 'SkitRuntimeUpdateNative', method, payload, callback);
    }

    var originalRequire = window.uni.requireNativePlugin;
    window.uni.requireNativePlugin = function (name) {
      if (name === 'SkitPangleDrama') {
        return {
          start: function (payload, callback) { callPangle('start', payload, callback); },
          list: function (payload, callback) { callPangle('list', payload, callback); },
          recommend: function (payload, callback) { callPangle('recommend', payload, callback); },
          history: function (payload, callback) { callPangle('history', payload, callback); },
          categoryList: function (payload, callback) { callPangle('categoryList', payload, callback); },
          listWithCategory: function (payload, callback) { callPangle('listWithCategory', payload, callback); },
          search: function (payload, callback) { callPangle('search', payload, callback); },
          listWithIds: function (payload, callback) { callPangle('listWithIds', payload, callback); },
          openPlayer: function (payload, callback) { callPangle('openPlayer', payload, callback); },
        };
      }
      if (name === 'SkitTakuAd') {
        return {
          showRewardedVideo: function (payload, callback) { callTaku('showRewardedVideo', payload, callback); },
        };
      }
      if (name === 'SkitRuntimeUpdate') {
        return {
          getInfo: function (payload, callback) { callRuntimeUpdate('getInfo', payload, callback); },
          installWebBundle: function (payload, callback) { callRuntimeUpdate('installWebBundle', payload, callback); },
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
