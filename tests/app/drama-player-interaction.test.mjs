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
