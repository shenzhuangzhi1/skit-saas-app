import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const playerSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
const unlockErrorSource = readFileSync(
  resolve(root, 'pages/drama/services/ad-unlock-error.mjs'),
  'utf8',
);

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = playerSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function zIndex(rule) {
  const match = rule.match(/z-index:\s*(-?\d+)/);
  return match ? Number(match[1]) : 0;
}

test('locked episode controls stay above the player placeholder for touch input', () => {
  const placeholderLayer = cssRule('.content-placeholder');
  const lockedLayer = cssRule('.locked-layer');

  assert.ok(
    zIndex(lockedLayer) > zIndex(placeholderLayer),
    'the visible unlock button must be in the top hit-testing layer',
  );
});

test('a terminal reward session is retried in the same unlock tap', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  assert.notEqual(unlockStart, -1, 'unlock flow must exist');
  assert.notEqual(unlockEnd, -1, 'unlock flow must have a closing boundary');
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);

  assert.match(unlockFlow, /prepareUnlockSession\(/);
  assert.doesNotMatch(unlockFlow, /\.getPendingSessions\(/);
});

test('refreshes a cached unlock against the server before deciding whether to show another ad', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  assert.notEqual(unlockStart, -1, 'unlock flow must exist');
  assert.notEqual(unlockEnd, -1, 'unlock flow must have a closing boundary');
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);

  assert.doesNotMatch(
    unlockFlow,
    /if \(isUnlocked\(currentEpisode\.value\)\) \{\s*return;/,
    'a display-only entitlement cache must never end the unlock flow before server refresh',
  );
  assert.match(
    unlockFlow,
    /if \(isUnlocked\(unlockEpisode\)\) \{\s*unlockStage = 'entitlements';\s*const snapshot = await refreshAuthoritativeEntitlements\(identity\);\s*assertPageRequestCurrent\(unlockRequest\);\s*if \(snapshot\.grantedEpisodeNos\.includes\(unlockEpisode\)\) \{[\s\S]*?await playCurrentEpisode\('server_entitled', null, unlockEpisode\)/,
  );
  assert.match(
    unlockFlow,
    /const prepared = await adSessionOrchestrator\.prepareUnlockSession\(identity, \{[\s\S]*?episodeNo: unlockEpisode,/,
  );
});

test('keeps a pending reward verification active without a second tap', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  assert.notEqual(unlockStart, -1, 'unlock flow must exist');
  assert.notEqual(unlockEnd, -1, 'unlock flow must have a closing boundary');
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);

  assert.match(
    unlockFlow,
    /schedulePendingRewardVerification\([\s\S]*?identity,[\s\S]*?unlockEpisode,[\s\S]*?result\.status\.sessionId,[\s\S]*?releaseUnlockOwnership,[\s\S]*?\)/,
  );

  const scheduleStart = playerSource.indexOf('function schedulePendingRewardVerification(');
  const scheduleEnd = playerSource.indexOf('\n  function ', scheduleStart + 1);
  assert.notEqual(scheduleStart, -1, 'pending reward scheduler must exist');
  assert.notEqual(scheduleEnd, -1, 'pending reward scheduler must have a closing boundary');
  const scheduler = playerSource.slice(scheduleStart, scheduleEnd);

  assert.match(scheduler, /watchPendingSession\(/);
  assert.match(scheduler, /result\.resolution === 'GRANTED'/);
  assert.match(scheduler, /grantedEpisodeNos\.value = result\.entitlements\.grantedEpisodeNos/);
});

test('unlock polling and its pending watcher hold shared foreground-recovery ownership', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);
  assert.match(
    unlockFlow,
    /releaseUnlockOwnership = await acquireAdSessionOwnership\(\{[\s\S]*?\.\.\.identity,[\s\S]*?dramaId,[\s\S]*?episodeNo: unlockEpisode,[\s\S]*?\}\)/,
  );
  assert.match(unlockFlow, /if \(!releaseUnlockOwnership\) \{/);
  assert.match(unlockFlow, /本集广告奖励确认中，请稍后查看/);
  assert.match(unlockFlow, /schedulePendingRewardVerification\([\s\S]*?releaseUnlockOwnership/);
  assert.match(unlockFlow, /if \(ownershipTransferred\) \{\s*releaseUnlockOwnership = null/);
  assert.match(unlockFlow, /finally \{\s*releaseUnlockOwnership\?\.\(\)/);

  const scheduleStart = playerSource.indexOf('function schedulePendingRewardVerification(');
  const scheduleEnd = playerSource.indexOf('\n  async function ', scheduleStart + 1);
  const scheduler = playerSource.slice(scheduleStart, scheduleEnd);
  assert.match(scheduler, /typeof releaseOwnership !== 'function'/);
  assert.match(scheduler, /\.finally\(\(\) => \{[\s\S]*?releaseOwnership\(\)/);
});

test('an early ad close is incomplete and never starts the long verification watcher', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);

  assert.match(
    unlockFlow,
    /adPlayback = await runNativeActivityPresentation\(\(\) =>\s*showDramaRewardedVideoAd\(/,
  );
  assert.match(unlockFlow, /adPlayback\.outcome === 'INCOMPLETE'/);
  assert.match(unlockFlow, /广告未完整观看，请重新观看/);
  const incompleteBranch = unlockFlow.slice(
    unlockFlow.indexOf("adPlayback.outcome === 'INCOMPLETE'"),
    unlockFlow.indexOf("result.resolution === 'GRANTED'"),
  );
  assert.doesNotMatch(incompleteBranch, /schedulePendingRewardVerification\(/);
});

test('a terminal SDK error after reward evidence keeps polling in the same unlock tap', () => {
  const helperStart = playerSource.indexOf('function hasTerminalRewardEvidence(error)');
  const helperEnd = playerSource.indexOf('\n  function ', helperStart + 1);
  assert.notEqual(helperStart, -1, 'rewarded terminal error classifier must exist');
  const helper = playerSource.slice(helperStart, helperEnd);
  assert.match(helper, /nativeState === 'ERROR'/);
  assert.match(helper, /nativeState === 'CLOSED'/);
  assert.match(helper, /clientRewardObserved === true/);

  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);
  assert.match(
    unlockFlow,
    /catch \(error\) \{\s*if \(!hasTerminalRewardEvidence\(error\)\) \{\s*throw error;[\s\S]*?result = await adSessionOrchestrator\.pollSession\(identity, created\.sessionId\)/,
  );
  assert.match(unlockFlow, /result\.resolution === 'VERIFYING'/);
  assert.match(unlockFlow, /schedulePendingRewardVerification\(/);
});

test('a VERIFYING create outcome polls without handing a missing protocol to native SDK', () => {
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);

  assert.match(unlockFlow, /created\.outcome === 'VERIFYING'/);
  assert.match(unlockFlow, /created\.nativeProtocol/);
  assert.match(unlockFlow, /adSessionOrchestrator\.pollSession\([\s\S]*?created\.sessionId/);
});

test('reward messaging distinguishes incomplete, verifying, and unavailable states', () => {
  assert.match(playerSource, /广告未完整观看，请重新观看/);
  assert.match(playerSource, /奖励确认中/);
  assert.match(unlockErrorSource, /广告暂不可用/);
});

test('watch history begins after a player actually opens', () => {
  const playStart = playerSource.indexOf('async function playCurrentEpisode(');
  const playEnd = playerSource.indexOf('\n  function chooseEpisode', playStart);
  assert.notEqual(playStart, -1, 'protected player launch must exist');
  assert.notEqual(playEnd, -1, 'protected player launch must have a closing boundary');
  const playFlow = playerSource.slice(playStart, playEnd);

  assert.match(playFlow, /if \(targetEpisode > drama\.value\.freeEpisodes\)/);
  assert.match(
    playFlow,
    /const opened = await runNativeActivityPresentation\(\(\) =>[\s\S]*?openPangleDramaPlayer\([\s\S]*?if \(opened\?\.opened\) \{[\s\S]*?saveHistory\(drama\.value\.id, targetEpisode\)/,
  );

  const onLoadStart = playerSource.indexOf('onLoad((options) =>');
  const onLoadEnd = playerSource.indexOf('\n  onShow(', onLoadStart);
  assert.notEqual(onLoadStart, -1, 'page load flow must exist');
  assert.notEqual(onLoadEnd, -1, 'page load flow must have a closing boundary');
  const onLoadFlow = playerSource.slice(onLoadStart, onLoadEnd);

  assert.doesNotMatch(onLoadFlow, /saveHistory\(/);
});

test('expired server entitlement gives a clear locked result instead of a silent player return', () => {
  const playStart = playerSource.indexOf('async function playCurrentEpisode(');
  const playEnd = playerSource.indexOf('\n  function chooseEpisode', playStart);
  assert.notEqual(playStart, -1, 'protected player launch must exist');
  assert.notEqual(playEnd, -1, 'protected player launch must have a closing boundary');
  const playFlow = playerSource.slice(playStart, playEnd);

  assert.match(
    playFlow,
    /if \(!snapshot\.grantedEpisodeNos\.includes\(targetEpisode\)\) \{[\s\S]*?return \{ skipped: true, reason: 'not-entitled' \};/,
  );
  assert.match(
    playFlow,
    /source === 'manual_open' \|\| source === 'episode_select'[\s\S]*?title: `第\$\{targetEpisode\}集需要解锁`/,
  );
});

test('retries automatic playback after login identity hydration', () => {
  const watcherStart = playerSource.indexOf('watch(\n    () => [userStore.userInfo?.tenantId');
  assert.notEqual(watcherStart, -1, 'identity watcher must exist');
  const watcher = playerSource.slice(
    watcherStart,
    playerSource.indexOf('\n  );', watcherStart) + 5,
  );

  assert.match(watcher, /playAfterServerSync\('identity_ready'\)/);
});

test('stale entitlement and player responses cannot mutate a newer page authorization scope', () => {
  assert.match(playerSource, /createDramaPageAsyncGuard/);
  assert.match(playerSource, /const pageAsyncGuard = createDramaPageAsyncGuard\(\)/);

  const refreshStart = playerSource.indexOf('async function refreshAuthoritativeEntitlements(');
  const refreshEnd = playerSource.indexOf('\n  async function ', refreshStart + 1);
  const refreshFlow = playerSource.slice(refreshStart, refreshEnd);
  assert.match(
    refreshFlow,
    /const entitlementRequest = beginPageRequest\('entitlements', identity, dramaId\)/,
  );
  assert.match(
    refreshFlow,
    /const snapshot = await adSessionOrchestrator\.refreshEntitlements\(identity, dramaId\);\s*assertPageRequestCurrent\(entitlementRequest\);\s*grantedEpisodeNos\.value = snapshot\.grantedEpisodeNos/,
  );

  const playStart = playerSource.indexOf('async function playCurrentEpisode(');
  const playEnd = playerSource.indexOf('\n  function chooseEpisode', playStart);
  const playFlow = playerSource.slice(playStart, playEnd);
  assert.match(playFlow, /playerRequest = beginPageRequest\('player', identity, dramaId\)/);
  assert.match(
    playFlow,
    /await refreshAuthoritativeEntitlements\(identity\);\s*assertPageRequestCurrent\(playerRequest\)/,
  );
  assert.match(
    playFlow,
    /const playerGrant = await adSessionOrchestrator\.issuePlayerGrant\(identity, dramaId\);\s*assertPageRequestCurrent\(playerRequest\)/,
  );
  assert.match(
    playFlow,
    /const opened = await runNativeActivityPresentation\(\(\) =>[\s\S]*?openPangleDramaPlayer\([\s\S]*?\);\s*assertPageRequestCurrent\(playerRequest\)/,
  );
  assert.match(
    playFlow,
    /function assertPlayerLaunchCurrent\(\) \{[\s\S]*?assertPageVisibleRequestCurrent\(playerRequest\)[\s\S]*?currentEpisode\.value !== targetEpisode/,
  );
  assert.match(
    playFlow,
    /if \(rawCurrentVideoUrl\.value\) \{\s*assertPlayerLaunchCurrent\(\);\s*pendingRawPlaybackEpisode = null;\s*activePlaybackEpisode\.value = targetEpisode/,
    'an H5 video must not start after its page becomes hidden or its episode changes',
  );
  assert.match(playFlow, /assertCurrent: assertPlayerLaunchCurrent/);
  assert.match(playFlow, /playerRequest && !isPageVisibleRequestCurrent\(playerRequest\)/);
});

test('a stale server sync cannot chain into an automatic player launch', () => {
  const helperStart = playerSource.indexOf('async function playAfterServerSync(');
  const helperEnd = playerSource.indexOf('\n  function ', helperStart + 1);
  assert.notEqual(helperStart, -1, 'automatic playback must have a guarded sync helper');
  assert.notEqual(helperEnd, -1, 'guarded sync helper must have a closing boundary');
  const helper = playerSource.slice(helperStart, helperEnd);

  assert.match(helper, /const syncResult = await syncServerState\(\)/);
  assert.match(
    helper,
    /if \(!syncResult\?\.request \|\| !isPageRequestCurrent\(syncResult\.request\)\) \{\s*return syncResult;/,
  );
  assert.match(
    helper,
    /const playback = await playCurrentEpisode\(source\);\s*assertPageRequestCurrent\(syncResult\.request\)/,
  );
});

test('pending verification is UI-silent after leaving the page and always releases ownership', () => {
  const scheduleStart = playerSource.indexOf('function schedulePendingRewardVerification(');
  const scheduleEnd = playerSource.indexOf('\n  async function ', scheduleStart + 1);
  const scheduler = playerSource.slice(scheduleStart, scheduleEnd);

  assert.match(
    scheduler,
    /const pendingRequest = beginPageRequest\(`pending:\$\{sessionId\}`, identity, dramaId\)/,
  );
  assert.match(
    scheduler,
    /if \(!isPageRequestCurrent\(pendingRequest\)\) \{\s*return;\s*\}[\s\S]*?grantedEpisodeNos\.value = result\.entitlements\.grantedEpisodeNos/,
  );
  assert.match(
    scheduler,
    /await waitForPageUiRequestCurrent\(pendingRequest\);\s*assertPageRequestCurrent\(pendingRequest\)/,
  );
  assert.match(scheduler, /\.finally\(\(\) => \{[\s\S]*?releaseOwnership\(\)/);
  assert.match(playerSource, /onUnload\(\(\) => \{[\s\S]*?pageAsyncGuard\.deactivate\(\)/);
});

test('native rewarded-ad activity does not invalidate the active unlock generation', () => {
  assert.match(
    playerSource,
    /async function runNativeActivityPresentation\(operation\) \{[\s\S]*?pageAsyncGuard\.beginPresentation\(\)[\s\S]*?return await operation\(\);[\s\S]*?finishPresentation\?\.\(\)/,
  );
  assert.match(
    playerSource,
    /adPlayback = await runNativeActivityPresentation\(\(\) =>\s*showDramaRewardedVideoAd\(/,
  );
  assert.match(
    playerSource,
    /onHide\(\(\) => \{[\s\S]*?pageAsyncGuard\.setVisible\(false\);\s*if \(pageAsyncGuard\.isPresenting\(\)\)/,
  );
  const unlockStart = playerSource.indexOf('async function unlockCurrent()');
  const unlockEnd = playerSource.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = playerSource.slice(unlockStart, unlockEnd);
  assert.match(
    unlockFlow,
    /if \(result\.resolution === 'GRANTED'\)[\s\S]*?releaseUnlockOwnership = null;\s*await waitForPageUiRequestCurrent\(unlockRequest\);\s*assertPageRequestCurrent\(unlockRequest\);\s*grantedEpisodeNos\.value/,
  );
  assert.match(unlockFlow, /unlockRequest && !isPageVisibleRequestCurrent\(unlockRequest\)/);
  assert.match(
    playerSource,
    /foregroundSyncPending[\s\S]*?pageAsyncGuard\.isVisible\(\)[\s\S]*?syncServerState\(\)/,
  );
});

test('changing episodes invalidates a player request before native launch', () => {
  const watcherStart = playerSource.indexOf('watch(currentEpisode');
  const watcherEnd = playerSource.indexOf('\n  });', watcherStart) + 5;
  const watcher = playerSource.slice(watcherStart, watcherEnd);

  assert.match(watcher, /pageAsyncGuard\.invalidateChannel\('player'\)/);
  assert.match(watcher, /pageAsyncGuard\.invalidateChannel\('unlock'\)/);
});

test('leaving or changing the reward scope cancels native ad loading immediately', () => {
  assert.match(playerSource, /cancelPendingDramaRewardedVideoAd/);

  const episodeWatcherStart = playerSource.indexOf('watch(currentEpisode');
  const episodeWatcherEnd = playerSource.indexOf('\n  });', episodeWatcherStart) + 5;
  assert.match(
    playerSource.slice(episodeWatcherStart, episodeWatcherEnd),
    /cancelPendingDramaRewardedVideoAd\(\)/,
  );

  const identityWatcherStart = playerSource.indexOf(
    'watch(\n    () => [userStore.userInfo?.tenantId',
  );
  const identityWatcherEnd = playerSource.indexOf('\n  );', identityWatcherStart) + 5;
  assert.match(
    playerSource.slice(identityWatcherStart, identityWatcherEnd),
    /cancelPendingDramaRewardedVideoAd\(\)/,
  );

  const hideStart = playerSource.indexOf('onHide(() =>');
  const hideEnd = playerSource.indexOf('\n  });', hideStart) + 5;
  assert.match(playerSource.slice(hideStart, hideEnd), /cancelPendingDramaRewardedVideoAd\(\)/);

  const unloadStart = playerSource.indexOf('onUnload(() =>');
  const unloadEnd = playerSource.indexOf('\n  });', unloadStart) + 5;
  assert.match(playerSource.slice(unloadStart, unloadEnd), /cancelPendingDramaRewardedVideoAd\(\)/);
});

test('a raw-video launch interrupted in background retries only after the page is visible again', () => {
  assert.match(playerSource, /let pendingRawPlaybackEpisode = null/);

  const playbackStart = playerSource.indexOf('async function playCurrentEpisode(');
  const playbackEnd = playerSource.indexOf('\n  function chooseEpisode', playbackStart);
  const playback = playerSource.slice(playbackStart, playbackEnd);
  assert.match(
    playback,
    /if \(rawCurrentVideoUrl\.value\) \{\s*pendingRawPlaybackEpisode = targetEpisode;\s*\}\s*const playerGrant = await/,
  );
  assert.match(
    playback,
    /if \(rawCurrentVideoUrl\.value\) \{\s*assertPlayerLaunchCurrent\(\);\s*pendingRawPlaybackEpisode = null;\s*activePlaybackEpisode\.value = targetEpisode;/,
  );

  const resumeStart = playerSource.indexOf('async function syncAndResumePendingRawPlayback()');
  const resumeEnd = playerSource.indexOf('\n  function ', resumeStart + 1);
  const resume = playerSource.slice(resumeStart, resumeEnd);
  assert.notEqual(resumeStart, -1, 'raw playback needs a foreground-only resume helper');
  assert.match(resume, /await syncServerState\(\)/);
  assert.match(
    resume,
    /!pageAsyncGuard\.isVisible\(\)[\s\S]*?pendingRawPlaybackEpisode === null[\s\S]*?pendingRawPlaybackEpisode !== currentEpisode\.value[\s\S]*?!rawCurrentVideoUrl\.value[\s\S]*?locked\.value/,
  );
  assert.match(resume, /await playCurrentEpisode\('foreground_resume'/);

  const onShowStart = playerSource.indexOf('onShow(() =>');
  const onShowEnd = playerSource.indexOf('\n  });', onShowStart) + 5;
  assert.match(playerSource.slice(onShowStart, onShowEnd), /syncAndResumePendingRawPlayback\(\)/);
  assert.match(playerSource, /onUnload\(\(\) => \{[\s\S]*?pendingRawPlaybackEpisode = null/);
  assert.match(playerSource, /watch\(currentEpisode,[\s\S]*?pendingRawPlaybackEpisode = null/);
});
