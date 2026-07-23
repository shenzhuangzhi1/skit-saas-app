import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

async function loadAuthCompletion() {
  try {
    return await import(pathToFileURL(resolve(root, 'pages/auth/auth-completion.mjs')).href);
  } catch {
    return {};
  }
}

async function loadAuthSessionState() {
  try {
    return await import(pathToFileURL(resolve(root, 'sheep/services/auth-session-state.mjs')).href);
  } catch {
    return {};
  }
}

test('authentication completes only after the protected member profile is hydrated', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();
  const events = [];

  assert.equal(
    typeof completeMemberAuth,
    'function',
    'auth completion must expose a protected-profile verification step',
  );

  const completion = await completeMemberAuth({
    authenticate: async () => {
      events.push('token');
      return {
        code: 0,
        data: { accessToken: 'redacted', userId: 42, tenantId: 162 },
      };
    },
    hydrateProfile: async () => {
      events.push('profile');
      return { id: 42, tenantId: 162 };
    },
  });
  events.push('complete');

  assert.deepEqual(events, ['token', 'profile', 'complete']);
  assert.equal(completion.ok, true);
  assert.equal(completion.profile.id, 42);
});

test('authentication stays incomplete when the protected profile cannot be verified', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();

  await assert.rejects(
    () =>
      completeMemberAuth({
        authenticate: async () => ({
          code: 0,
          data: { accessToken: 'redacted', userId: 42, tenantId: 162 },
        }),
        hydrateProfile: async () => undefined,
      }),
    (error) => error?.code === 'AUTH_SESSION_UNVERIFIED',
  );
});

test('failed authentication responses do not request a protected profile', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();
  let profileRequests = 0;

  const completion = await completeMemberAuth({
    authenticate: async () => ({ code: 1001002000, msg: '登录失败' }),
    hydrateProfile: async () => {
      profileRequests += 1;
      return { id: 42 };
    },
  });

  assert.equal(completion.ok, false);
  assert.equal(profileRequests, 0);
});

test('a code-zero response without a token never completes an old local session', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();
  let profileRequests = 0;

  await assert.rejects(
    () =>
      completeMemberAuth({
        authenticate: async () => ({ code: 0, data: { userId: 42, tenantId: 162 } }),
        hydrateProfile: async () => {
          profileRequests += 1;
          return { id: 42, tenantId: 162 };
        },
      }),
    (error) => error?.code === 'AUTH_SESSION_UNVERIFIED',
  );
  assert.equal(profileRequests, 0);
});

test('authentication rejects a protected profile from another member or tenant', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();

  await assert.rejects(
    () =>
      completeMemberAuth({
        authenticate: async () => ({
          code: 0,
          data: { accessToken: 'redacted', userId: 42, tenantId: 162 },
        }),
        hydrateProfile: async () => ({ id: 43, tenantId: 162 }),
      }),
    (error) => error?.code === 'AUTH_IDENTITY_MISMATCH',
  );
});

test('authentication rejects a session invalidated while its profile request was in flight', async () => {
  const { completeMemberAuth } = await loadAuthCompletion();
  const snapshot = { epoch: 7, memberId: '42', tenantId: '162' };
  let current = true;

  await assert.rejects(
    () =>
      completeMemberAuth({
        authenticate: async () => ({
          code: 0,
          data: { accessToken: 'redacted', userId: 42, tenantId: 162 },
        }),
        captureSession: () => snapshot,
        hydrateProfile: async () => {
          current = false;
          return { id: 42, tenantId: 162 };
        },
        validateSession: (captured) => captured === snapshot && current,
      }),
    (error) => error?.code === 'AUTH_SESSION_STALE',
  );
});

test('auth session epochs and identities reject stale cross-login work', async () => {
  const { authEpochMatches, authIdentityMatches, nextAuthSessionEpoch } =
    await loadAuthSessionState();

  assert.equal(nextAuthSessionEpoch?.(7), 8);
  assert.equal(authEpochMatches?.(7, 8), false);
  assert.equal(
    authIdentityMatches?.({ userId: 42, tenantId: 162 }, { id: '42', tenantId: '162' }),
    true,
  );
  assert.equal(
    authIdentityMatches?.({ userId: 42, tenantId: 162 }, { id: 43, tenantId: 162 }),
    false,
  );
});

test('persisting a token does not launch a detached profile request', () => {
  const userStore = read('sheep/store/user.js');
  const setToken = userStore.slice(
    userStore.indexOf('setToken(token'),
    userStore.indexOf('// 更新用户相关信息'),
  );

  assert.doesNotMatch(
    setToken,
    /loginAfter\(/,
    'the login page must await profile hydration instead of setToken launching it in the background',
  );
});

test('loginAfter returns the protected profile response instead of cached auth identity', () => {
  const userStore = read('sheep/store/user.js');
  const loginAfter = userStore.slice(
    userStore.indexOf('async loginAfter('),
    userStore.indexOf('// 登出系统'),
  );

  assert.match(loginAfter, /const profile = await this\.getInfo\(session\)/);
  assert.match(loginAfter, /return profile/);
  assert.doesNotMatch(loginAfter, /updateUserData\(/);
});

test('the login page verifies the protected profile before leaving the auth route', () => {
  const authPage = read('pages/auth/index.vue');
  const submitLogin = authPage.slice(
    authPage.indexOf('async function submitLogin()'),
    authPage.indexOf('async function resolveInvitation()'),
  );

  assert.match(
    authPage,
    /import \{ completeMemberAuth(?:,\s*formatAuthFailure)? \} from '\.\/auth-completion\.mjs'/,
  );
  assert.match(submitLogin, /await completeMemberAuth\(/);
  assert.match(
    submitLogin,
    /captureSession:\s*\(\) => \(submittedSession = userStore\.getAuthSessionSnapshot\(\)\)/,
  );
  assert.match(submitLogin, /hydrateProfile:\s*\(session\) => userStore\.loginAfter\(session\)/);
  assert.match(
    submitLogin,
    /validateSession:\s*\(session\) => userStore\.isAuthSessionCurrent\(session\)/,
  );
  assert.match(
    submitLogin,
    /submittedSession && userStore\.isAuthSessionCurrent\(submittedSession\)[\s\S]*?resetUserData\(\)/,
  );
  assert.ok(
    submitLogin.indexOf('await completeMemberAuth(') < submitLogin.indexOf('finishAuth()'),
    'navigation must happen only after the protected profile request succeeds',
  );
});

test('startup restoration and login hydration are bound to the captured session epoch', () => {
  const appStore = read('sheep/store/app.js');
  const userStore = read('sheep/store/user.js');
  const loginAfter = userStore.slice(
    userStore.indexOf('async loginAfter('),
    userStore.indexOf('// 登出系统'),
  );

  assert.match(appStore, /await userStore\.loginAfter\(userStore\.getAuthSessionSnapshot\(\)\)/);
  assert.match(loginAfter, /this\.isAuthSessionCurrent\(session\)/);
  assert.doesNotMatch(loginAfter, /getAdConfig\(/);
});

test('401 refresh and logout paths refuse stale session epochs', () => {
  const request = read('sheep/request/index.js');
  const userStore = read('sheep/store/user.js');

  assert.match(request, /authSessionEpoch/);
  assert.match(request, /new Map\(\)/);
  assert.match(request, /AuthUtil\.refreshToken\(refreshTokenValue,\s*expectedEpoch\)/);
  assert.match(request, /handleAuthorized\(expectedEpoch\)/);
  assert.match(request, /isAuthEpochCurrent\(expectedEpoch\)/);
  assert.doesNotMatch(request, /let requestList = \[\]/);
  assert.doesNotMatch(request, /let isRefreshToken = false/);
  assert.match(userStore, /beginAuthSession\(/);
  assert.match(userStore, /applyRefreshResult\(/);

  const refreshAction = userStore.slice(
    userStore.indexOf('applyRefreshResult('),
    userStore.indexOf('// 设置 token'),
  );
  assert.doesNotMatch(
    refreshAction,
    /applyAuthResult\(/,
    'a token refresh must not replace an already hydrated member profile',
  );
});

test('a new login claims its epoch before old refresh work can log it out', () => {
  const authPage = read('pages/auth/index.vue');
  const authApi = read('sheep/api/member/auth.js');
  const request = read('sheep/request/index.js');
  const userStore = read('sheep/store/user.js');
  const submitLogin = authPage.slice(
    authPage.indexOf('async function submitLogin()'),
    authPage.indexOf('async function resolveInvitation()'),
  );

  assert.match(submitLogin, /const authAttemptEpoch = userStore\.claimAuthAttempt\(\)/);
  assert.match(submitLogin, /AuthUtil\.login\([^;]*authAttemptEpoch\)/s);
  assert.match(authApi, /login:\s*\(data,\s*authSessionEpoch\)/);
  assert.match(authApi, /authSessionEpoch/);
  assert.match(
    request,
    /beginAuthSession\(\s*authData,\s*response\.config\.custom\?\.authSessionEpoch/s,
  );
  assert.match(userStore, /claimAuthAttempt\(\)/);
  assert.match(userStore, /beginAuthSession\(data = \{\}, expectedEpoch\)/);
});

test('a replayed response is rejected if another waiter logged out that epoch', () => {
  const request = read('sheep/request/index.js');

  assert.match(request, /const replayResult = await request\(config\)/);
  assert.match(
    request,
    /const replayResult = await request\(config\)[\s\S]*?!userStore\.isAuthEpochCurrent\(expectedEpoch\)[\s\S]*?return rejectStaleAuthSession\(\)[\s\S]*?return replayResult/,
  );
});

test('auth diagnostics retain only status, code and a redacted query-free path', async () => {
  const { formatAuthFailure } = await loadAuthCompletion();

  assert.equal(
    formatAuthFailure?.({
      stage: 'business-response',
      httpStatus: 200,
      code: 401,
      url: '/skit/member/user/profile?mobile=13800000000&token=secret',
    }),
    '[auth] business-response http=200 code=401 path=/skit/member/user/profile',
  );
  assert.equal(
    formatAuthFailure?.({
      stage: 'transport-response',
      httpStatus: 401,
      code: 401,
      url: 'https://www.yunque8.top/app-api/skit/member/user/13800000000/profile',
    }),
    '[auth] transport-response http=401 code=401 path=/app-api/skit/member/user/redacted/profile',
  );
});

test('both business and transport 401 responses emit sanitized auth diagnostics', () => {
  const request = read('sheep/request/index.js');

  assert.match(request, /formatAuthFailure/);
  assert.match(request, /stage:\s*'business-response'/);
  assert.match(request, /stage:\s*'transport-response'/);
});

test('the login API does not announce success before profile verification', () => {
  const authApi = read('sheep/api/member/auth.js');
  const loginRequest = authApi.slice(
    authApi.indexOf('login: (data)'),
    authApi.indexOf('// 使用邀请码注册账号'),
  );

  assert.doesNotMatch(loginRequest, /showSuccess:\s*true/);
});
