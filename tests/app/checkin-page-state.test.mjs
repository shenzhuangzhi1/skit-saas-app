import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('check-in page exposes real loading, error, retry, and point-record states', () => {
  const source = read('pages/app/sign.vue');

  assert.match(source, /title="签到打卡"/);
  assert.match(source, /navbar="normal"/);
  assert.match(source, /state\.error/);
  assert.match(source, /重新加载/);
  assert.match(source, /function retrySignInfo/);
  assert.match(source, /state\.ready/);
  assert.match(source, /查看积分记录/);
  assert.match(source, /onShow\(\(\)\s*=>\s*\{[\s\S]*?getSignInfo/);
  assert.match(source, /const authSession = captureCurrentAuthSession\(\)/);
  assert.match(
    source,
    /const \{ code, data \} = await SignInApi\.createSignInRecord\(\);[\s\S]*?if \(!isCurrentAuthSession\(authSession\)\)/,
  );
  assert.match(source, /markPostCheckIn\(result\.signInDate, authSession\)/);
  assert.match(
    source,
    /function markPostCheckIn\(signInDate, authSession\)[\s\S]*?tenantId: authSession\.tenantId[\s\S]*?memberId: authSession\.memberId/,
  );
  assert.match(
    source,
    /watch\(\s*\(\) => userStore\.authSessionEpoch,[\s\S]*?state\.showModel = false;[\s\S]*?state\.signInfo = null;/,
  );
  assert.doesNotMatch(source, /v-bind\(['"]headerBg['"]\)/);
});

test('check-in and point records use the same safe opaque navigation design', () => {
  const sign = read('pages/app/sign.vue');
  const score = read('pages/user/wallet/score.vue');
  const routes = JSON.parse(read('pages.json')).subPackages;
  const signRoute = routes
    .find((item) => item.root === 'pages/app')
    ?.pages.find((item) => item.path === 'sign');
  const pointRoute = routes
    .find((item) => item.root === 'pages/user')
    ?.pages.find((item) => item.path === 'wallet/score');

  assert.match(sign, /<s-layout[^>]+title="签到打卡"[^>]+navbar="normal"/);
  assert.match(score, /<s-layout[^>]+title="积分记录"[^>]+navbar="normal"/);
  assert.equal(signRoute?.style?.navigationBarTitleText, '签到打卡');
  assert.equal(signRoute?.meta?.title, '签到打卡');
  assert.equal(pointRoute?.style?.navigationBarTitleText, '积分记录');
  assert.equal(pointRoute?.meta?.title, '积分记录');
  assert.doesNotMatch(score, /marginTop:\s*['"]-['"]/);
  assert.doesNotMatch(score, /navbar="inner"/);
});

test('point records distinguish request failure from a real empty list and show balance after change', () => {
  const source = read('pages/user/wallet/score.vue');

  assert.match(source, /state\.error/);
  assert.match(source, /retryPointRecords/);
  assert.match(source, /变动后余额/);
  assert.match(source, /balanceAfter/);
  assert.match(
    source,
    /共\s*\{\{\s*state\.recordsReady\s*\?\s*state\.pagination\.total\s*:\s*['"]--['"]\s*\}\}\s*条/,
  );
  assert.match(source, /Array\.isArray\(e\)/);
  assert.match(source, /type="arrowdown"/);
  assert.doesNotMatch(source, /type="down"/);
  assert.match(source, /userStore\.getAuthSessionSnapshot\(\)/);
  assert.match(source, /userStore\.isAuthSessionCurrent\(request\.authSession\)/);
  assert.match(source, /authSessionSignature/);
  assert.match(source, /onShow\(\(\)\s*=>/);
  assert.match(source, /pointBalanceText/);
  assert.match(source, /state\.recordsReady/);
  assert.match(
    source,
    /const finishedCurrent = pointQueryGate\.finish\(request\);[\s\S]*?if \(finishedCurrent && userStore\.isAuthSessionCurrent\(request\.authSession\)\) \{[\s\S]*?state\.initialLoading = false;/,
  );
});

test('pending reward grant waits for the drama page to return instead of being dropped while hidden', () => {
  const source = read('pages/drama/play.vue');
  const watcher = source.match(
    /function schedulePendingRewardVerification\([\s\S]*?\n  }\n\n  async function syncServerState/,
  )?.[0];

  assert.ok(watcher, 'pending reward watcher must exist');
  assert.match(
    watcher,
    /await waitForPageUiRequestCurrent\(pendingRequest\)[\s\S]*?playCurrentEpisode/,
  );
  assert.doesNotMatch(
    watcher,
    /if \(!isPageUiRequestCurrent\(pendingRequest\)\) \{\s*return;\s*\}/,
  );
});
