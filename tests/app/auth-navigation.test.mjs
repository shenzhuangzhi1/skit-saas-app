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
  const openLogin = createAuthNavigationGate?.({
    getPages: () => [{ route: 'pages/drama/play' }],
    navigateTo: (options) => requests.push(options),
  });

  assert.equal(
    typeof openLogin,
    'function',
    'auth navigation must expose a single-flight login opener',
  );
  assert.equal(openLogin(), true);
  assert.equal(openLogin(), false);
  assert.equal(requests.length, 1);
});

test('drama playback uses the single-flight member login opener', () => {
  const playPage = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');

  assert.match(playPage, /import \{ showAuthModal \} from '@\/sheep\/hooks\/useModal'/);
  assert.doesNotMatch(playPage, /url:\s*['"]\/pages\/auth\/index\?mode=login['"]/);
});
