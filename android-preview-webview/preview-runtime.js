(function () {
  var adVideo = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

  function addStyle() {
    if (document.getElementById('skit-preview-runtime-style')) return;
    var style = document.createElement('style');
    style.id = 'skit-preview-runtime-style';
    style.textContent = [
      '.fake-video .episode-badge,.fake-video .video-copy,.fake-video .locked-layer{z-index:2;}',
      '.fake-video .skit-content-note{position:absolute;left:50%;top:50%;z-index:1;transform:translate(-50%,-50%);width:72%;box-sizing:border-box;padding:18px 16px;border-radius:14px;background:rgba(0,0,0,.42);color:#fff;text-align:center;font-size:15px;font-weight:700;line-height:1.45;}',
      '.fake-video .skit-content-note small{display:block;margin-top:6px;color:rgba(255,255,255,.68);font-size:12px;font-weight:500;}',
      '.skit-ad-mask{position:fixed;inset:0;z-index:99999;background:#050505;display:flex;flex-direction:column;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.skit-ad-head{height:76px;box-sizing:border-box;display:flex;align-items:flex-end;justify-content:space-between;padding:24px 18px 12px;font-size:15px;background:rgba(0,0,0,.72);z-index:2;}',
      '.skit-ad-close{border:1px solid rgba(255,255,255,.35);border-radius:18px;padding:7px 14px;color:#fff;background:rgba(255,255,255,.12);font-size:13px;}',
      '.skit-ad-close[disabled]{opacity:.45;}',
      '.skit-ad-video{flex:1;width:100%;height:calc(100% - 76px);object-fit:contain;background:#000;}',
      '.skit-ad-action{position:absolute;left:50%;bottom:42px;z-index:100001;transform:translateX(-50%);min-width:172px;border:0;border-radius:24px;padding:13px 22px;color:#111;background:#f7d66b;font-size:15px;font-weight:700;box-shadow:0 10px 28px rgba(0,0,0,.32);display:none;}',
      '.skit-ad-action.is-ready{display:block;}',
      '.skit-ad-action[disabled]{opacity:.55;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureContentPlaceholder() {
    if (!String(location.hash || '').includes('/pages/drama/play')) return;
    var box = document.querySelector('.fake-video');
    if (!box) return;
    addStyle();
    var legacyVideo = box.querySelector('.skit-real-video');
    if (legacyVideo) legacyVideo.remove();
    if (!box.querySelector('.skit-content-note')) {
      var note = document.createElement('div');
      note.className = 'skit-content-note';
      note.innerHTML = '真实短剧资源未接入<small>需接入穿山甲短剧 SDK 或配置授权剧集 URL</small>';
      box.insertBefore(note, box.firstChild);
    }
  }

  function showRewardAd(payload, callback) {
    addStyle();
    var mask = document.createElement('div');
    mask.className = 'skit-ad-mask';
    mask.innerHTML =
      '<div class="skit-ad-head">' +
      '<span>激励视频广告</span>' +
      '<button class="skit-ad-close" disabled>完整观看后解锁</button>' +
      '</div>' +
      '<video class="skit-ad-video" autoplay muted playsinline webkit-playsinline></video>' +
      '<button class="skit-ad-action" disabled>完整观看后领取</button>';
    document.body.appendChild(mask);

    var video = mask.querySelector('video');
    var close = mask.querySelector('button');
    var action = mask.querySelector('.skit-ad-action');
    var completed = false;
    function finishAd(label) {
      completed = true;
      close.disabled = false;
      close.textContent = label || '领取奖励';
      action.disabled = false;
      action.textContent = '领取奖励';
      action.classList.add('is-ready');
    }
    function grantReward() {
      if (!completed) return;
      mask.remove();
      callback({
        completed: true,
        rewarded: true,
        closed: true,
        mock: false,
        provider: 'preview-video',
        raw: { preview: true, payload: payload || {} },
      });
    }
    video.src = adVideo;
    video.addEventListener('ended', function () {
      finishAd('领取奖励');
    });
    video.addEventListener('error', function () {
      finishAd('广告播放完成');
      console.warn('[skit-preview] reward ad video failed, allowing preview reward.', payload);
    });
    video.addEventListener('click', function () {
      if (video.paused && !completed) video.play().catch(function () {});
    });
    close.addEventListener('click', grantReward);
    action.addEventListener('click', grantReward);
    video.play().catch(function () {});
  }

  function installNativePluginBridge() {
    if (!window.uni || window.uni.__skitPreviewBridgeInstalled) return;
    var originalRequire = window.uni.requireNativePlugin;
    window.uni.requireNativePlugin = function (name) {
      if (name === 'SkitTakuAd' || name === 'SkitGroMoreAd') {
        return {
          showRewardedVideo: function (payload, callback) {
            showRewardAd(payload, function (result) {
              if (typeof callback === 'function') callback(result);
            });
          },
        };
      }
      return typeof originalRequire === 'function' ? originalRequire(name) : null;
    };
    window.uni.__skitPreviewBridgeInstalled = true;
    console.log('[skit-preview] native ad bridge installed');
  }

  function tick() {
    installNativePluginBridge();
    ensureContentPlaceholder();
  }

  addStyle();
  setInterval(tick, 500);
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', function () {
    setTimeout(tick, 80);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
})();
