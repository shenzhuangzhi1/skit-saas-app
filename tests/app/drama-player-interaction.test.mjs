import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const playerSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');

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
    /if \(isUnlocked\(unlockEpisode\)\) \{\s*const snapshot = await refreshAuthoritativeEntitlements\(identity\);\s*if \(snapshot\.grantedEpisodeNos\.includes\(unlockEpisode\)\) \{[\s\S]*?await playCurrentEpisode\('server_entitled', null, unlockEpisode\)/,
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
    /schedulePendingRewardVerification\(identity, unlockEpisode, result\.status\.sessionId\)/,
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

test('watch history begins after a player actually opens', () => {
  const playStart = playerSource.indexOf('async function playCurrentEpisode(');
  const playEnd = playerSource.indexOf('\n  function chooseEpisode', playStart);
  assert.notEqual(playStart, -1, 'protected player launch must exist');
  assert.notEqual(playEnd, -1, 'protected player launch must have a closing boundary');
  const playFlow = playerSource.slice(playStart, playEnd);

  assert.match(
    playFlow,
    /if \(targetEpisode > drama\.value\.freeEpisodes\)/,
  );
  assert.match(
    playFlow,
    /const opened = await openPangleDramaPlayer\([\s\S]*?if \(opened\?\.opened\) \{[\s\S]*?saveHistory\(drama\.value\.id, targetEpisode\)/,
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
  const watcher = playerSource.slice(watcherStart, playerSource.indexOf('\n  );', watcherStart) + 5);

  assert.match(
    watcher,
    /syncServerState\(\)\s*\.then\(\(\) => playCurrentEpisode\('identity_ready'\)\)/,
  );
});
