import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdSessionRecoveryCoordinator } from '../../pages/drama/services/ad-session-recovery-coordinator.js';

const identity = Object.freeze({ tenantId: 'tenant-a', memberId: 'member-a' });
const scopeA = Object.freeze({ ...identity, dramaId: 901, episodeNo: 7 });
const scopeB = Object.freeze({ ...identity, dramaId: 902, episodeNo: 1 });
const sessionA = 'session_0123456789ABCD';
const sessionB = 'session_9876543210WXYZ';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a live unlock owner queues only the same scope recovery until the owner releases', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const release = await coordinator.acquire(scopeA);
  let recoveryCalls = 0;

  const recovery = coordinator.runRecovery(scopeA, sessionA, async () => {
    recoveryCalls += 1;
    return ['recovered-after-unlock'];
  });
  await Promise.resolve();
  assert.equal(recoveryCalls, 0);
  release();
  assert.deepEqual(await recovery, ['recovered-after-unlock']);
  assert.equal(recoveryCalls, 1);
});

test('unlock acquisition waits for an older recovery of the same scope', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const recoveryStarted = deferred();
  const allowRecoveryToFinish = deferred();
  const recovery = coordinator.runRecovery(scopeA, sessionA, async () => {
    recoveryStarted.resolve();
    await allowRecoveryToFinish.promise;
    return ['recovered-before-unlock'];
  });
  await recoveryStarted.promise;

  let ownerAcquired = false;
  const owner = coordinator.acquire(scopeA).then((release) => {
    ownerAcquired = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(ownerAcquired, false);

  allowRecoveryToFinish.resolve();
  assert.deepEqual(await recovery, ['recovered-before-unlock']);
  const release = await owner;
  assert.equal(ownerAcquired, true);

  assert.equal(await coordinator.acquire(scopeA), null);
  let overlappingRecoveryCalls = 0;
  const queuedRecovery = coordinator.runRecovery(scopeA, sessionA, async () => {
    overlappingRecoveryCalls += 1;
    return ['recovered-after-owner'];
  });
  await Promise.resolve();
  assert.equal(overlappingRecoveryCalls, 0);
  release();
  assert.deepEqual(await queuedRecovery, ['recovered-after-owner']);
  assert.equal(overlappingRecoveryCalls, 1);
});

test('App and page share one queued recovery for the same session', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const release = await coordinator.acquire(scopeA);
  let recoveryCalls = 0;
  const first = coordinator.runRecovery(scopeA, sessionA, async () => {
    recoveryCalls += 1;
    return ['recovered-once'];
  });
  const second = coordinator.runRecovery(scopeA, sessionA, async () => {
    recoveryCalls += 1;
    return ['unexpected-second-recovery'];
  });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(recoveryCalls, 0);

  release();
  assert.deepEqual(await first, ['recovered-once']);
  assert.deepEqual(await second, ['recovered-once']);
  assert.equal(recoveryCalls, 1);
  const nextRelease = await coordinator.acquire(scopeA);
  assert.equal(typeof nextRelease, 'function');
  nextRelease();
});

test('a pending session never blocks a different drama or episode for the same member', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const releaseA = await coordinator.acquire(scopeA);
  assert.equal(typeof releaseA, 'function');

  const releaseB = await coordinator.acquire(scopeB);
  assert.equal(typeof releaseB, 'function');

  let sameScopeRecoveryCalls = 0;
  const sameScopeRecovery = coordinator.runRecovery(scopeA, sessionA, async () => {
    sameScopeRecoveryCalls += 1;
    return ['scope-a'];
  });
  let otherScopeRecoveryCalls = 0;
  const otherScopeRecovery = coordinator.runRecovery(scopeB, sessionB, async () => {
    otherScopeRecoveryCalls += 1;
    return ['scope-b'];
  });
  await Promise.resolve();
  assert.equal(sameScopeRecoveryCalls, 0);
  assert.equal(otherScopeRecoveryCalls, 0);

  releaseB();
  assert.deepEqual(await otherScopeRecovery, ['scope-b']);
  assert.equal(otherScopeRecoveryCalls, 1);
  assert.equal(sameScopeRecoveryCalls, 0);

  releaseA();
  assert.deepEqual(await sameScopeRecovery, ['scope-a']);
  assert.equal(sameScopeRecoveryCalls, 1);
});
