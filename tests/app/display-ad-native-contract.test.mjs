import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function installRuntimeBridge() {
  const messages = [];
  const events = [];
  const window = {
    uni: {
      requireNativePlugin() {
        return null;
      },
    },
    SkitNativeBridge: {
      postMessage(rawMessage) {
        messages.push(JSON.parse(rawMessage));
      },
    },
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  const context = {
    console: { log() {} },
    document: {
      readyState: 'complete',
      addEventListener() {},
    },
    setInterval() {
      return 1;
    },
    window,
  };
  vm.runInNewContext(read('android-djx-runtime/djx-runtime.js'), context);
  return { events, messages, plugin: window.uni.requireNativePlugin('SkitTakuAd'), window };
}

test('H5 Taku plugin forwards each display-ad method over its own native route', () => {
  const { messages, plugin } = installRuntimeBridge();
  const displayPayload = { placementId: 'tenant-display-1', scene: 'home_banner' };

  const interstitialRequestId = plugin.showInterstitial(displayPayload, () => {});
  plugin.cancelInterstitial({ requestId: interstitialRequestId }, () => {});
  const bannerRequestId = plugin.showBanner(displayPayload, () => {});
  const hideRequestId = plugin.hideBanner({ scene: 'home_banner' }, () => {});

  assert.match(bannerRequestId, /^djx_\d+_\d+$/);
  assert.match(hideRequestId, /^djx_\d+_\d+$/);

  assert.deepEqual(
    messages.map(({ bridge, method, payload }) => ({ bridge, method, payload })),
    [
      { bridge: 'TAKU', method: 'showInterstitial', payload: displayPayload },
      {
        bridge: 'TAKU',
        method: 'cancelInterstitial',
        payload: { requestId: interstitialRequestId },
      },
      { bridge: 'TAKU', method: 'showBanner', payload: displayPayload },
      { bridge: 'TAKU', method: 'hideBanner', payload: { scene: 'home_banner' } },
    ],
  );
});

test('forgetting a timed-out display request removes its H5 callback without a native call', () => {
  const { messages, plugin, window } = installRuntimeBridge();
  let staleCallbackCount = 0;
  const requestId = plugin.showBanner(
    { placementId: 'tenant-display-1', scene: 'home_banner' },
    () => {
      staleCallbackCount += 1;
    },
  );

  assert.equal(plugin.forgetRequestCallback({ requestId }), true);
  window.__SkitNativeBridgeResolve(requestId, JSON.stringify({ success: true }));

  assert.equal(staleCallbackCount, 0);
  assert.equal(messages.length, 1);
});

test('cancelling an interstitial forgets its timed-out H5 callback', () => {
  const { plugin, window } = installRuntimeBridge();
  let staleCallbackCount = 0;

  const requestId = plugin.showInterstitial(
    { placementId: 'tenant-display-1', scene: 'post_checkin_drama' },
    () => {
      staleCallbackCount += 1;
    },
  );
  const cancellationId = plugin.cancelInterstitial({ requestId }, () => {});

  assert.match(requestId, /^djx_\d+_\d+$/);
  assert.match(cancellationId, /^djx_\d+_\d+$/);
  window.__SkitNativeBridgeResolve(requestId, JSON.stringify({ success: false }));
  assert.equal(staleCallbackCount, 0);
});

test('native banner close is forwarded to the H5 page lifecycle', () => {
  const { events, window } = installRuntimeBridge();

  window.__SkitNativeBannerLifecycleEmit(
    JSON.stringify({ state: 'CLOSED', scene: 'home_banner' }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'skit:taku-banner-lifecycle');
  assert.deepEqual(
    JSON.parse(JSON.stringify(events[0].detail)),
    { state: 'CLOSED', scene: 'home_banner' },
  );
});

test('native bridge keeps rewarded protocol parsing separate from strict display payloads', () => {
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );

  assert.match(bridge, /"showRewardedVideo"\.equals\(method\)[\s\S]*?parseProtocol\(payload\)/);
  assert.match(bridge, /"showInterstitial"\.equals\(method\)/);
  assert.match(bridge, /"cancelInterstitial"\.equals\(method\)/);
  assert.match(bridge, /"showBanner"\.equals\(method\)/);
  assert.match(bridge, /"hideBanner"\.equals\(method\)/);
  assert.match(
    bridge,
    /parseDisplayRequest\([\s\S]*?payload\.length\(\) != DISPLAY_FIELDS\.size\(\)/,
    'show display payloads must contain exactly placementId and scene',
  );
  assert.match(
    bridge,
    /parseBannerHideRequest\([\s\S]*?payload\.length\(\) != BANNER_HIDE_FIELDS\.size\(\)/,
    'hideBanner must accept only its scene scope',
  );
  assert.match(
    bridge,
    /parseInterstitialCancelRequest\([\s\S]*?payload\.length\(\) != INTERSTITIAL_CANCEL_FIELDS\.size\(\)/,
    'cancelInterstitial must accept only the original native request ID',
  );
  assert.match(bridge, /\[A-Za-z0-9\._:-\]\{1,128\}/);
  assert.match(bridge, /\[A-Za-z0-9\._:-\]\{1,64\}/);
  assert.match(
    bridge,
    /BuildConfig\.TAKU_REWARD_PLACEMENT_ID\.equals\(placementId\)/,
    'display ads must reject the rewarded-video placement',
  );
  assert.doesNotMatch(
    bridge,
    /DISPLAY_(?:INTERSTITIAL|BANNER)_PLACEMENT_ID/,
    'display placement IDs must come from the H5/backend payload, not BuildConfig',
  );
});

test('interstitial controller uses Taku and emits one terminal result for close or failure', () => {
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuInterstitialAdController.java',
  );

  assert.match(controller, /import com\.anythink\.interstitial\.api\.ATInterstitial;/);
  assert.match(controller, /import com\.anythink\.interstitial\.api\.ATInterstitialListener;/);
  assert.match(controller, /new ATInterstitial\(activity, request\.getPlacementId\(\)\)/);
  assert.match(controller, /setAdListener\(new ATInterstitialListener\(\)/);
  assert.match(controller, /onInterstitialAdLoaded\(\)[\s\S]*?ad\.show\(activity/);
  assert.match(controller, /onInterstitialAdClose\([\s\S]*?complete\(session, true, "CLOSED"/);
  assert.match(controller, /onInterstitialAdLoadFail\([\s\S]*?completeFailure/);
  assert.match(controller, /onInterstitialAdVideoError\([\s\S]*?completeFailure/);
  assert.match(controller, /INTERSTITIAL_TERMINAL_TIMEOUT_MILLIS = 120_000L/);
  assert.match(
    controller,
    /onInterstitialAdLoaded\(\)[\s\S]*?cancelLoadTimeout\(session\)[\s\S]*?scheduleTerminalTimeout\(session\)[\s\S]*?ad\.show\(activity\)/,
    'a loaded interstitial must replace its load deadline with a terminal watchdog',
  );
  assert.match(
    controller,
    /scheduleTerminalTimeout\([\s\S]*?INTERSTITIAL_TERMINAL_TIMEOUT_MILLIS/,
  );
  assert.match(controller, /boolean cancel\(String requestId\)/);
  assert.match(
    controller,
    /terminal\.compareAndSet\(false, true\)/,
    'close, load failure and video failure must race through one terminal gate',
  );
  assert.match(controller, /"4001"\.equals\(code\) \|\| "4009"\.equals\(code\)/);
  assert.match(controller, /destroyAd\(\)/);
});

test('banner controller reuses one matching view and releases it on hide or destroy', () => {
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuBannerAdController.java',
  );

  assert.match(controller, /import com\.anythink\.banner\.api\.ATBannerView;/);
  assert.match(controller, /import com\.anythink\.banner\.api\.ATBannerListener;/);
  assert.match(controller, /import com\.anythink\.core\.api\.ATAdConst;/);
  assert.match(
    controller,
    /active != null && active\.matches\(request\)[\s\S]*?active\.respondOrQueue\(listener\)[\s\S]*?return;/,
    'repeated showBanner for the same scene must not allocate another view',
  );
  assert.match(controller, /new ATBannerView\(activity\)/);
  assert.match(controller, /setPlacementId\(request\.getPlacementId\(\)\)/);
  assert.match(controller, /setBannerAdListener\(new ATBannerListener\(\)/);
  assert.match(controller, /getDisplayMetrics\(\)\.widthPixels/);
  assert.match(controller, /bannerWidth \/ \(320f \/ 50f\)/);
  assert.match(controller, /localExtra\.put\(ATAdConst\.KEY\.AD_WIDTH, bannerWidth\)/);
  assert.match(controller, /localExtra\.put\(ATAdConst\.KEY\.AD_HEIGHT, bannerHeight\)/);
  assert.match(
    controller,
    /view\.setLocalExtra\(localExtra\)[\s\S]*?host\.removeAllViews\(\)[\s\S]*?host\.addView\(view, new FrameLayout\.LayoutParams\(\s*bannerWidth,\s*bannerHeight\)\)[\s\S]*?view\.loadAd\(\)/,
    'Taku banner dimensions must be configured before load and match the host child exactly',
  );
  assert.doesNotMatch(
    controller,
    /onBannerLoaded\(\)[\s\S]*?respondAll\(true,[\s\S]*?onBannerShow/,
    'load alone must not resolve the banner request successfully',
  );
  assert.match(
    controller,
    /onBannerShow\(ATAdInfo adInfo\)[\s\S]*?cancelTimeout\(banner\)[\s\S]*?respondAll\(true, "SHOWING", null\)/,
    'only the provider show callback may report banner success',
  );
  assert.match(controller, /void hide\([\s\S]*?releaseActive/);
  assert.match(controller, /void destroy\([\s\S]*?releaseActive/);
  assert.match(
    controller,
    /onBannerClose\(ATAdInfo adInfo\)[\s\S]*?releaseActive\("CLOSED"\)[\s\S]*?lifecycleListener\.onClosed\(scene\)/,
    'the H5 page must be notified when the user closes the native banner',
  );
  assert.match(controller, /view\.destroy\(\)/);
});

test('home page clears banner spacing when native reports a user close', () => {
  const page = read('pages/index/index.vue');
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );

  assert.match(page, /window\.addEventListener\(BANNER_LIFECYCLE_EVENT/);
  assert.match(page, /window\.removeEventListener\(BANNER_LIFECYCLE_EVENT/);
  assert.match(
    page,
    /detail\?\.state === 'CLOSED'[\s\S]*?detail\?\.scene === DISPLAY_AD_SCENES\.HOME_BANNER[\s\S]*?homeBannerVisible\.value = false/,
  );
  assert.match(bridge, /new TakuBannerAdController\([\s\S]*?this::emitBannerClosed/);
  assert.match(
    bridge,
    /__SkitNativeBannerLifecycleEmit[\s\S]*?originGuard\.requireTrustedTopLevel\(\)[\s\S]*?webView\.evaluateJavascript/,
  );
});

test('MainActivity overlays a fixed banner host above the bottom navigation and destroys it', () => {
  const main = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/MainActivity.java',
  );

  assert.match(main, /private static final int BOTTOM_NAV_HEIGHT_DP = 56;/);
  assert.match(main, /private FrameLayout rootContainer;/);
  assert.match(main, /private FrameLayout bannerHost;/);
  assert.match(main, /rootContainer\.addView\(webView/);
  assert.match(main, /bannerLayout\.gravity = Gravity\.BOTTOM;/);
  assert.match(main, /bannerLayout\.bottomMargin = dpToPx\(BOTTOM_NAV_HEIGHT_DP\);/);
  assert.match(main, /rootContainer\.addView\(bannerHost, bannerLayout\)/);
  assert.match(main, /new SkitTakuAdBridge\([\s\S]*?bannerHost/);
  assert.match(main, /takuAdBridge\.destroy\(\)/);
});

test('display requests have bounded ownership so stale SDK callbacks cannot show later', () => {
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );
  const interstitial = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuInterstitialAdController.java',
  );
  const banner = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuBannerAdController.java',
  );

  assert.match(bridge, /DISPLAY_LOAD_TIMEOUT_MILLIS = 14_000L/);
  assert.match(bridge, /SystemClock\.elapsedRealtime\(\) \+ DISPLAY_LOAD_TIMEOUT_MILLIS/);
  assert.match(bridge, /cancelDisplayBootstrapRegistrations\(\)/);
  assert.match(interstitial, /active == session[\s\S]*?!session\.terminal\.get\(\)/);
  assert.match(interstitial, /deadlineElapsedRealtime - SystemClock\.elapsedRealtime\(\)/);
  assert.match(
    interstitial,
    /onInterstitialAdLoaded\(\)[\s\S]*?SystemClock\.elapsedRealtime\(\) >= session\.deadlineElapsedRealtime/,
  );
  assert.match(
    interstitial,
    /cancelLoadTimeout\(session\)[\s\S]*?cancelTerminalTimeout\(session\)[\s\S]*?destroyAd\(session\.ad\)/,
  );
  assert.match(banner, /active == banner/);
  assert.match(banner, /deadlineElapsedRealtime - SystemClock\.elapsedRealtime\(\)/);
  assert.match(
    banner,
    /onBannerLoaded\(\)[\s\S]*?SystemClock\.elapsedRealtime\(\) >= banner\.deadlineElapsedRealtime/,
  );
  assert.match(banner, /cancelTimeout\(banner\)[\s\S]*?host\.removeAllViews\(\)/);
});
