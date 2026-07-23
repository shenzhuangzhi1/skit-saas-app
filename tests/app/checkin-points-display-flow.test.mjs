import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

async function loadDisplayAdFlow() {
  const moduleUrl = pathToFileURL(resolve(root, 'pages/drama/services/display-ad-flow.mjs'));
  moduleUrl.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

function memoryStorage() {
  const values = new Map();
  return {
    getStorageSync(key) {
      return values.get(key);
    },
    setStorageSync(key, value) {
      values.set(key, value);
    },
    removeStorageSync(key) {
      values.delete(key);
    },
    value(key) {
      return values.get(key);
    },
  };
}

test('post-check-in ad marker is identity scoped and consumed by the first drama play only', async () => {
  const { createDisplayAdFlow, POST_CHECK_IN_MARKER_KEY } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  const events = [];
  const plugin = {
    showInterstitial(payload, callback) {
      events.push(`ad:${payload.scene}:${payload.placementId}`);
      callback({ success: true, closed: true });
    },
  };
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => plugin,
    now: () => new Date('2026-07-24T08:00:00+08:00'),
  });
  const identity = { tenantId: 162, memberId: 88, signInDate: '2026-07-24' };

  flow.markPostCheckIn(identity);
  assert.deepEqual(JSON.parse(storage.value(POST_CHECK_IN_MARKER_KEY)), {
    tenantId: '162',
    memberId: '88',
    signInDate: '2026-07-24',
  });

  await flow.runBeforeDramaPlay({
    ...identity,
    placementId: 'post-checkin-placement',
    openPlayer: () => events.push('play:first'),
  });
  await flow.runBeforeDramaPlay({
    ...identity,
    placementId: 'post-checkin-placement',
    openPlayer: () => events.push('play:second'),
  });

  assert.deepEqual(events, [
    'ad:post_checkin_first_play_interstitial:post-checkin-placement',
    'play:first',
    'play:second',
  ]);
  assert.equal(storage.value(POST_CHECK_IN_MARKER_KEY), undefined);
});

test('post-check-in marker never leaks to a different member or tenant', async () => {
  const { createDisplayAdFlow, POST_CHECK_IN_MARKER_KEY } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  let adCalls = 0;
  let playCalls = 0;
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => ({
      showInterstitial(_payload, callback) {
        adCalls += 1;
        callback({ success: true, closed: true });
      },
    }),
    now: () => new Date('2026-07-24T08:00:00+08:00'),
  });

  flow.markPostCheckIn({ tenantId: 162, memberId: 88, signInDate: '2026-07-24' });
  await flow.runBeforeDramaPlay({
    tenantId: 162,
    memberId: 89,
    signInDate: '2026-07-24',
    placementId: 'post-checkin-placement',
    openPlayer: () => {
      playCalls += 1;
    },
  });

  assert.equal(adCalls, 0);
  assert.equal(playCalls, 1);
  assert.notEqual(storage.value(POST_CHECK_IN_MARKER_KEY), undefined);
});

test('a check-in just before midnight still inserts the first-play ad after midnight', async () => {
  const { createDisplayAdFlow, POST_CHECK_IN_MARKER_KEY } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  const events = [];
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => ({
      showInterstitial(payload, callback) {
        events.push(`ad:${payload.scene}`);
        callback({ success: true, closed: true });
      },
    }),
  });

  flow.markPostCheckIn({ tenantId: 162, memberId: 88, signInDate: '2026-07-24' });
  await flow.runBeforeDramaPlay({
    tenantId: 162,
    memberId: 88,
    signInDate: '2026-07-25',
    placementId: 'post-checkin-placement',
    openPlayer: () => events.push('play'),
  });

  assert.deepEqual(events, ['ad:post_checkin_first_play_interstitial', 'play']);
  assert.equal(storage.value(POST_CHECK_IN_MARKER_KEY), undefined);
});

test('an expired post-check-in marker is cleared without showing an old ad', async () => {
  const { createDisplayAdFlow, POST_CHECK_IN_MARKER_KEY } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  let adCalls = 0;
  let playCalls = 0;
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => ({
      showInterstitial(_payload, callback) {
        adCalls += 1;
        callback({ success: true, closed: true });
      },
    }),
  });

  flow.markPostCheckIn({ tenantId: 162, memberId: 88, signInDate: '2026-07-22' });
  await flow.runBeforeDramaPlay({
    tenantId: 162,
    memberId: 88,
    signInDate: '2026-07-25',
    placementId: 'post-checkin-placement',
    openPlayer: () => {
      playCalls += 1;
    },
  });

  assert.equal(adCalls, 0);
  assert.equal(playCalls, 1);
  assert.equal(storage.value(POST_CHECK_IN_MARKER_KEY), undefined);
});

test('no-fill and rapid double tap fail open while opening the selected drama once', async () => {
  const { createDisplayAdFlow } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  let callback;
  let adCalls = 0;
  let playCalls = 0;
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => ({
      showInterstitial(_payload, next) {
        adCalls += 1;
        callback = next;
      },
    }),
    now: () => new Date('2026-07-24T08:00:00+08:00'),
  });
  const identity = { tenantId: 162, memberId: 88, signInDate: '2026-07-24' };
  flow.markPostCheckIn(identity);

  const first = flow.runBeforeDramaPlay({
    ...identity,
    placementId: 'post-checkin-placement',
    openPlayer: () => {
      playCalls += 1;
    },
  });
  const second = flow.runBeforeDramaPlay({
    ...identity,
    placementId: 'post-checkin-placement',
    openPlayer: () => {
      playCalls += 1;
    },
  });
  callback({ success: false, reason: 'NO_FILL' });
  await Promise.all([first, second]);

  assert.equal(adCalls, 1);
  assert.equal(playCalls, 1);
});

test('placement lookup is inside the single flight and a stale page cannot navigate after the ad', async () => {
  const { createDisplayAdFlow, POST_CHECK_IN_MARKER_KEY } = await loadDisplayAdFlow();
  const storage = memoryStorage();
  let finishPlacementLookup;
  let finishAd;
  let pageCurrent = true;
  const opened = [];
  const flow = createDisplayAdFlow({
    storage,
    getNativePlugin: () => ({
      showInterstitial(_payload, callback) {
        finishAd = callback;
      },
    }),
    now: () => new Date('2026-07-24T08:00:00+08:00'),
  });
  const identity = { tenantId: 162, memberId: 88, signInDate: '2026-07-24' };
  flow.markPostCheckIn(identity);

  const first = flow.runBeforeDramaPlay({
    ...identity,
    resolvePlacement: () =>
      new Promise((resolve) => {
        finishPlacementLookup = resolve;
      }),
    canOpenPlayer: () => pageCurrent,
    openPlayer: () => opened.push('first'),
  });
  const second = flow.runBeforeDramaPlay({
    ...identity,
    resolvePlacement: async () => 'should-never-run',
    canOpenPlayer: () => true,
    openPlayer: () => opened.push('second'),
  });

  assert.equal(first, second);
  finishPlacementLookup('post-checkin-placement');
  await new Promise((resolve) => setTimeout(resolve, 0));
  pageCurrent = false;
  finishAd({ success: true, closed: true });
  await Promise.all([first, second]);

  assert.deepEqual(opened, []);
  assert.notEqual(
    storage.value(POST_CHECK_IN_MARKER_KEY),
    undefined,
    'leaving before playback must preserve the first-play ad marker',
  );
});

test('banner hide is inside the play single flight and cannot navigate after leaving home', async () => {
  const { createDisplayAdFlow } = await loadDisplayAdFlow();
  let finishBannerHide;
  let pageCurrent = true;
  let beforePlayCalls = 0;
  let playCalls = 0;
  const flow = createDisplayAdFlow({
    storage: memoryStorage(),
    getNativePlugin: () => null,
  });

  const first = flow.runBeforeDramaPlay({
    beforePlay: () => {
      beforePlayCalls += 1;
      return new Promise((resolve) => {
        finishBannerHide = resolve;
      });
    },
    canOpenPlayer: () => pageCurrent,
    openPlayer: () => {
      playCalls += 1;
    },
  });
  const second = flow.runBeforeDramaPlay({
    beforePlay: async () => {
      beforePlayCalls += 1;
    },
    canOpenPlayer: () => true,
    openPlayer: () => {
      playCalls += 1;
    },
  });

  assert.equal(first, second);
  assert.equal(beforePlayCalls, 1);
  pageCurrent = false;
  finishBannerHide();
  await Promise.all([first, second]);

  assert.equal(playCalls, 0);
});

test('page visit guard rejects delayed work after leave and re-entry', async () => {
  const { createPageVisitGuard } = await loadDisplayAdFlow();
  const guard = createPageVisitGuard();
  const firstVisit = guard.enter();
  let finishConfigLookup;
  let nativeCalls = 0;
  const delayedEntryAd = (async () => {
    await new Promise((resolve) => {
      finishConfigLookup = resolve;
    });
    if (guard.isCurrent(firstVisit)) {
      nativeCalls += 1;
    }
  })();

  guard.leave();
  const secondVisit = guard.enter();
  finishConfigLookup();
  await delayedEntryAd;

  assert.equal(guard.isCurrent(firstVisit), false);
  assert.equal(guard.isCurrent(secondVisit), true);
  assert.equal(nativeCalls, 0);
});

test('native display-ad failureReason is preserved for diagnostics', async () => {
  const { createDisplayAdFlow } = await loadDisplayAdFlow();
  const flow = createDisplayAdFlow({
    storage: memoryStorage(),
    getNativePlugin: () => ({
      showInterstitial(_payload, callback) {
        callback({ success: false, failureReason: 'NO_FILL' });
      },
    }),
  });

  const result = await flow.showCheckInEntryInterstitial('checkin-placement');

  assert.equal(result.shown, false);
  assert.equal(result.reason, 'NO_FILL');
});

test('interstitial timeout cancels the matching native request before failing open', async () => {
  const { createDisplayAdFlow } = await loadDisplayAdFlow();
  const cancellations = [];
  const flow = createDisplayAdFlow({
    storage: memoryStorage(),
    interstitialTimeoutMs: 5,
    getNativePlugin: () => ({
      showInterstitial() {
        return 'djx_123_1';
      },
      cancelInterstitial(payload, callback) {
        cancellations.push(payload);
        callback({ success: true, cancelled: true });
      },
    }),
  });

  const result = await flow.showCheckInEntryInterstitial('checkin-placement');

  assert.equal(result.shown, false);
  assert.equal(result.reason, 'NATIVE_AD_TIMEOUT');
  assert.deepEqual(cancellations, [{ requestId: 'djx_123_1' }]);
});

test('banner hide fails open when the native bridge never calls back', async () => {
  const { createDisplayAdFlow } = await loadDisplayAdFlow();
  const forgotten = [];
  const flow = createDisplayAdFlow({
    storage: memoryStorage(),
    timeoutMs: 5,
    getNativePlugin: () => ({
      hideBanner() {
        // Deliberately never resolves: navigation must still continue.
        return 'djx_123_2';
      },
      forgetRequestCallback(payload) {
        forgotten.push(payload);
      },
    }),
  });

  const result = await flow.hideHomeBanner();

  assert.equal(result.hidden, false);
  assert.equal(result.reason, 'NATIVE_AD_TIMEOUT');
  assert.deepEqual(forgotten, [{ requestId: 'djx_123_2' }]);
});

test('check-in and points pages use the Skit identity domain and contain no pseudo point row', () => {
  const signApi = read('sheep/api/member/signin.js');
  const pointApi = read('sheep/api/member/point.js');
  const signPage = read('pages/app/sign.vue');
  const pointPage = read('pages/user/wallet/score.vue');
  const profilePage = read('pages/index/user.vue');
  const homePage = read('pages/index/index.vue');
  const displayFlow = read('pages/drama/services/display-ad-flow.mjs');
  const playerGateway = read('pages/drama/services/pangle-content.js');

  assert.match(signApi, /\/skit\/member\/check-ins/);
  assert.doesNotMatch(signApi, /(?<!\/skit)\/member\/sign-in\//);
  assert.match(pointApi, /\/skit\/member\/point-records/);
  assert.doesNotMatch(pointApi, /(?<!\/skit)\/member\/point\//);

  assert.match(signPage, /awardedPoints/);
  assert.match(signPage, /markPostCheckIn/);
  assert.match(signPage, /showCheckInEntryInterstitial/);
  assert.match(signPage, /createPageVisitGuard/);
  assert.match(signPage, /userStore\.getAdConfig\(\)/);
  assert.doesNotMatch(
    signPage,
    /showCheckInEntryInterstitial\(\)[\s\S]*?userStore\.updateUserData\(true\)/,
  );
  assert.doesNotMatch(signPage, /超额积分|抵现金|experience/);
  const markerIndex = signPage.indexOf('const markerStored');
  const refreshIndex = signPage.indexOf('Promise.allSettled');
  assert.ok(markerIndex >= 0 && refreshIndex > markerIndex);
  assert.match(pointPage, /list:\s*\[\]/);
  assert.doesNotMatch(pointPage, /list:\s*0/);
  assert.match(pointPage, /pointBalance/);
  assert.match(profilePage, /签到打卡/);
  assert.match(profilePage, /积分记录/);
  assert.match(homePage, /showHomeBanner/);
  assert.match(homePage, /beforePlay:\s*hideHomeBanner/);
  assert.match(homePage, /homeVisitGuard\.isCurrent/);
  assert.match(playerGateway, /runBeforeDramaPlay/);
  assert.match(playerGateway, /resolvePlacement/);
  assert.match(playerGateway, /postCheckInDramaInterstitial/);
  assert.match(playerGateway, /openDirectDramaPlayer[\s\S]*runBeforeDramaPlay/);
  assert.match(displayFlow, /INTERSTITIAL_TERMINAL_TIMEOUT_MS\s*=\s*120000/);
});

test('display-ad cache and rendering are scoped to the active tenant and visible home epoch', () => {
  const userStore = read('sheep/store/user.js');
  const appStore = read('sheep/store/app.js');
  const homePage = read('pages/index/index.vue');

  assert.match(userStore, /adConfigTenantId/);
  assert.match(userStore, /activeTenantScope/);
  assert.match(userStore, /adConfigTenantId !== requestTenantScope/);
  assert.match(userStore, /requestTenantScope[\s\S]*activeTenantScope\(\)\s*!==\s*requestTenantScope/);
  assert.match(userStore, /clearDisplayAdConfig/);
  assert.match(
    userStore,
    /identityChanged[\s\S]*clearPostCheckInMarker/,
    'token refresh for the same tenant/member must preserve the post-check-in marker',
  );

  assert.match(
    appStore,
    /userStore\.resetUserData\(\)/,
    'tenant switching must clear identity-bound ad state, not only tokens',
  );
  assert.doesNotMatch(
    appStore,
    /if \(newTenantId && newTenantId != oldTenantId\)[\s\S]*?userStore\.setToken\(\)/,
  );

  assert.match(homePage, /homeVisible/);
  assert.match(homePage, /bannerEpoch/);
  assert.match(homePage, /const requestEpoch = bannerEpoch\.value/);
  assert.match(
    homePage,
    /await loadDisplayAdConfig\(\)[\s\S]*?!homeVisible\.value[\s\S]*requestEpoch !== bannerEpoch\.value/,
  );
  assert.match(homePage, /onHide\(\(\) => \{[\s\S]*bannerEpoch\.value \+= 1/);
});

test('identity gate rejects legacy sign-in and point endpoints', () => {
  const gate = read('scripts/check-member-identity-boundary.mjs');
  assert.match(gate, /member\\\/\(\?:sign-in\|point\)/);
  assert.match(gate, /\/skit\/member\/check-ins/);
  assert.match(gate, /\/skit\/member\/point-records/);
});
