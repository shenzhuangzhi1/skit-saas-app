import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function loadAuthNavigation() {
  try {
    return await import(pathToFileURL(resolve(root, 'pages/auth/auth-navigation.mjs')).href);
  } catch {
    return {};
  }
}

test('successful authentication exits every trailing login page', async () => {
  const { resolveAuthExit } = await loadAuthNavigation();

  assert.equal(
    typeof resolveAuthExit,
    'function',
    'auth navigation must expose a route-stack resolver',
  );
  assert.deepEqual(
    resolveAuthExit([
      { route: 'pages/drama/play' },
      { route: 'pages/auth/index' },
      { route: 'pages/auth/index' },
    ]),
    { action: 'back', delta: 2 },
  );
});

test('login submission locks before waiting for the app context', () => {
  const authPage = readFileSync(resolve(root, 'pages/auth/index.vue'), 'utf8');
  const submitLogin = authPage.slice(
    authPage.indexOf('async function submitLogin()'),
    authPage.indexOf('async function resolveInvitation()'),
  );

  assert.ok(
    submitLogin.indexOf('state.submitting = true') <
      submitLogin.indexOf('await requireContextToken()'),
    'a repeated tap must not start a second login while app context is loading',
  );
});

test('member login navigation ignores a second request while the first is opening', async () => {
  const { createAuthNavigationGate } = await loadAuthNavigation();
  const requests = [];
  let pages = [{ route: 'pages/drama/play' }];
  const openAuth = createAuthNavigationGate?.({
    getPages: () => pages,
    navigateTo: (options) => requests.push(options),
  });

  assert.equal(
    typeof openAuth,
    'function',
    'auth navigation must expose a single-flight login opener',
  );
  assert.equal(openAuth('register'), true);
  assert.equal(openAuth('login'), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/pages/auth/index?mode=register');
  assert.equal(typeof openAuth.markReady, 'function');
  assert.equal(
    openAuth('login'),
    false,
    'the gate must remain closed while navigation succeeded but the old route stack is visible',
  );
  pages = [{ route: 'pages/drama/play' }, { route: 'pages/auth/index' }];
  openAuth.markReady();
  assert.equal(openAuth('login'), false, 'an active auth page must remain single-flight');
  pages = [{ route: 'pages/drama/play' }];
  assert.equal(openAuth('login'), true, 'the gate reopens after auth leaves the route stack');
});

test('drama playback uses the single-flight member login opener', () => {
  const playPage = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');

  assert.match(playPage, /import \{ showAuthModal \} from '@\/sheep\/hooks\/useModal'/);
  assert.doesNotMatch(playPage, /url:\s*['"]\/pages\/auth\/index\?mode=login['"]/);
});

test('the profile page also uses the shared single-flight auth opener', () => {
  const profilePage = readFileSync(resolve(root, 'pages/index/user.vue'), 'utf8');

  assert.match(profilePage, /import \{ showAuthPage \} from '@\/sheep\/hooks\/useModal'/);
  assert.match(profilePage, /function goAuth\(mode\) \{\s*showAuthPage\(mode\);\s*\}/);
  assert.doesNotMatch(profilePage, /\/pages\/auth\/index\?mode=/);
});

test('protected feature pages use the shared auth opener instead of raw route navigation', () => {
  const teamPage = readFileSync(resolve(root, 'pages/auth/team.vue'), 'utf8');

  assert.match(teamPage, /import \{ showAuthPage \} from '@\/sheep\/hooks\/useModal'/);
  assert.match(teamPage, /showAuthPage\('login'\)/);
  assert.doesNotMatch(
    teamPage,
    /uni\.(?:navigateTo|redirectTo|reLaunch)\([^)]*\/pages\/auth\/index/s,
  );
});

test('auth entry mode is explicit and an unrelated code query cannot force registration', async () => {
  const { resolveAuthEntry } = await loadAuthNavigation();

  assert.equal(typeof resolveAuthEntry, 'function', 'auth entry resolver must exist');
  assert.deepEqual(resolveAuthEntry({ mode: 'login', code: 'oauth-code' }), {
    mode: 'login',
    inviteCode: '',
  });
  assert.deepEqual(resolveAuthEntry({ inviteCode: 'INVITE-01' }), {
    mode: 'register',
    inviteCode: 'INVITE-01',
  });
  assert.deepEqual(resolveAuthEntry({ mode: 'invalid', code: 'oauth-code' }), {
    mode: 'login',
    inviteCode: '',
  });
});

test('login keeps mode switching disabled through profile verification', () => {
  const authPage = readFileSync(resolve(root, 'pages/auth/index.vue'), 'utf8');
  const setMode = authPage.slice(
    authPage.indexOf('function setMode(mode)'),
    authPage.indexOf('\n  function ', authPage.indexOf('function setMode(mode)') + 1),
  );

  assert.match(setMode, /if \(!canSwitchAuthMode\(state\.submitting\)\) \{\s*return;\s*\}/);
  assert.match(authPage, /import \{ markAuthPageReady \} from '@\/sheep\/hooks\/useModal'/);
  assert.match(authPage, /onLoad\(\(options = \{\}\) => \{\s*markAuthPageReady\(\)/);
  assert.match(authPage, /disabled:\s*state\.submitting/);
  assert.match(authPage, /\.mode-tab\.disabled[\s\S]*pointer-events:\s*none/);
  assert.doesNotMatch(authPage, /options\.inviteCode \|\| options\.code/);
});

test('mode switching stays locked until profile verification finishes', async () => {
  const { canSwitchAuthMode } = await loadAuthNavigation();

  assert.equal(typeof canSwitchAuthMode, 'function', 'mode lock helper must exist');
  assert.equal(canSwitchAuthMode(true), false);
  assert.equal(canSwitchAuthMode(false), true);
});

test('registration locks mode switching before invitation and app-context requests', () => {
  const authPage = readFileSync(resolve(root, 'pages/auth/index.vue'), 'utf8');
  const submitRegister = authPage.slice(
    authPage.indexOf('async function submitRegister()'),
    authPage.indexOf(
      '\n  function finishAuth()',
      authPage.indexOf('async function submitRegister()'),
    ),
  );

  assert.ok(
    submitRegister.indexOf('state.submitting = true') <
      submitRegister.indexOf('await resolveInvitation()'),
    'registration must lock the form before invitation verification starts',
  );
  assert.ok(
    submitRegister.indexOf('state.submitting = true') <
      submitRegister.indexOf('await requireContextToken()'),
    'registration must stay single-flight while app context loads',
  );
  assert.match(
    submitRegister,
    /try \{[\s\S]*?await resolveInvitation\(\)[\s\S]*?await requireContextToken\(\)[\s\S]*?\} finally \{\s*state\.submitting = false;\s*\}/,
  );
});
