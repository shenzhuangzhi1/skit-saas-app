(function () {
  function addStyle() {
    if (document.getElementById('skit-preview-runtime-style')) return;
    var style = document.createElement('style');
    style.id = 'skit-preview-runtime-style';
    style.textContent = [
      '.fake-video .episode-badge,.fake-video .video-copy,.fake-video .locked-layer{z-index:2;}',
      '.fake-video .skit-content-note{position:absolute;left:50%;top:50%;z-index:1;transform:translate(-50%,-50%);width:72%;box-sizing:border-box;padding:18px 16px;border-radius:14px;background:rgba(0,0,0,.42);color:#fff;text-align:center;font-size:15px;font-weight:700;line-height:1.45;}',
      '.fake-video .skit-content-note small{display:block;margin-top:6px;color:rgba(255,255,255,.68);font-size:12px;font-weight:500;}',
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

  function tick() {
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
