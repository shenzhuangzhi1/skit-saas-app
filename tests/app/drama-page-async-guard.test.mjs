import assert from 'node:assert/strict';
import test from 'node:test';

import { createDramaPageAsyncGuard } from '../../pages/drama/services/drama-page-async-guard.js';

const scopeA = Object.freeze({ tenantId: 'tenant-a', memberId: 'member-a', dramaId: 901 });
const scopeB = Object.freeze({ tenantId: 'tenant-b', memberId: 'member-b', dramaId: 901 });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('an in-flight entitlement response cannot overwrite a newer tenant/member context', async () => {
  const guard = createDramaPageAsyncGuard();
  guard.activate();
  let currentScope = scopeA;
  let grantedEpisodeNos = [];
  const responseA = deferred();
  const responseB = deferred();

  async function refresh(scope, response) {
    const request = guard.begin('entitlements', scope);
    const episodes = await response.promise;
    if (guard.isCurrent(request, currentScope)) {
      grantedEpisodeNos = episodes;
    }
  }

  const oldRefresh = refresh(scopeA, responseA);
  currentScope = scopeB;
  guard.invalidateRequests();
  const newRefresh = refresh(scopeB, responseB);

  responseB.resolve([2]);
  await newRefresh;
  responseA.resolve([7]);
  await oldRefresh;

  assert.deepEqual(grantedEpisodeNos, [2]);
});

test('an unload invalidates pending UI work but still allows server cleanup and owner release', async () => {
  const guard = createDramaPageAsyncGuard();
  guard.activate();
  const pending = deferred();
  const request = guard.begin('pending:session_0123456789ABCD', scopeA);
  let toastCalls = 0;
  let playerOpenCalls = 0;
  let ownerReleaseCalls = 0;

  const watcher = pending.promise
    .then(() => {
      if (!guard.isCurrent(request, scopeA)) {
        return;
      }
      toastCalls += 1;
      playerOpenCalls += 1;
    })
    .finally(() => {
      ownerReleaseCalls += 1;
    });

  guard.deactivate();
  pending.resolve({ resolution: 'GRANTED' });
  await watcher;

  assert.equal(toastCalls, 0);
  assert.equal(playerOpenCalls, 0);
  assert.equal(ownerReleaseCalls, 1);
});

test('a native presentation can finish in background but UI continuation waits for page show', async () => {
  const guard = createDramaPageAsyncGuard();
  guard.activate();
  guard.setVisible(true);
  const request = guard.begin('unlock', scopeA);
  const finishPresentation = guard.beginPresentation();
  guard.setVisible(false);

  let continued = false;
  const continuation = guard.waitForUi(request, scopeA).then(() => {
    continued = true;
  });
  finishPresentation();
  await Promise.resolve();
  assert.equal(continued, false, 'background completion must not resume protected UI work');

  guard.setVisible(true);
  await continuation;
  assert.equal(continued, true);
  assert.equal(guard.isUiCurrent(request, scopeA), true);
});

test('invalidating the player channel leaves an unrelated unlock request current', () => {
  const guard = createDramaPageAsyncGuard();
  guard.activate();
  guard.setVisible(true);
  const unlockRequest = guard.begin('unlock', scopeA);
  const playerRequest = guard.begin('player', scopeA);

  guard.invalidateChannel('player');

  assert.equal(guard.isCurrent(playerRequest, scopeA), false);
  assert.equal(guard.isCurrent(unlockRequest, scopeA), true);
});

test('a newer request rejects an older UI waiter on the same channel immediately', async () => {
  const guard = createDramaPageAsyncGuard();
  guard.activate();
  guard.setVisible(false);
  const oldRequest = guard.begin('player', scopeA);
  const oldWaiter = guard.waitForUi(oldRequest, scopeA);

  const newRequest = guard.begin('player', scopeA);

  await assert.rejects(oldWaiter, /页面异步上下文已经失效/);
  assert.equal(guard.isCurrent(newRequest, scopeA), true);
});
