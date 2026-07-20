import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdSessionRecoveryCoordinator } from '../../pages/drama/services/ad-session-recovery-coordinator.js';

const identity = Object.freeze({ tenantId: 'tenant-a', memberId: 'member-a' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a live unlock owner queues foreground recovery until the owner releases', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const release = await coordinator.acquire(identity);
  let recoveryCalls = 0;

  const recovery = coordinator.runRecovery(identity, async () => {
    recoveryCalls += 1;
    return ['recovered-after-unlock'];
  });
  await Promise.resolve();
  assert.equal(recoveryCalls, 0);
  release();
  assert.deepEqual(await recovery, ['recovered-after-unlock']);
  assert.equal(recoveryCalls, 1);
});

test('unlock acquisition waits for an older foreground recovery and then owns later recovery', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const recoveryStarted = deferred();
  const allowRecoveryToFinish = deferred();
  const recovery = coordinator.runRecovery(identity, async () => {
    recoveryStarted.resolve();
    await allowRecoveryToFinish.promise;
    return ['recovered-before-unlock'];
  });
  await recoveryStarted.promise;

  let ownerAcquired = false;
  const owner = coordinator.acquire(identity).then((release) => {
    ownerAcquired = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(ownerAcquired, false);

  allowRecoveryToFinish.resolve();
  assert.deepEqual(await recovery, ['recovered-before-unlock']);
  const release = await owner;
  assert.equal(ownerAcquired, true);

  assert.equal(await coordinator.acquire(identity), null);
  let overlappingRecoveryCalls = 0;
  const queuedRecovery = coordinator.runRecovery(identity, async () => {
    overlappingRecoveryCalls += 1;
    return ['recovered-after-owner'];
  });
  await Promise.resolve();
  assert.equal(overlappingRecoveryCalls, 0);
  release();
  assert.deepEqual(await queuedRecovery, ['recovered-after-owner']);
  assert.equal(overlappingRecoveryCalls, 1);
});

test('App and page share one queued recovery while an unlock owns the identity', async () => {
  const coordinator = createAdSessionRecoveryCoordinator();
  const release = await coordinator.acquire(identity);
  let recoveryCalls = 0;
  const first = coordinator.runRecovery(identity, async () => {
    recoveryCalls += 1;
    return ['recovered-once'];
  });
  const second = coordinator.runRecovery(identity, async () => {
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
  const nextRelease = await coordinator.acquire(identity);
  assert.equal(typeof nextRelease, 'function');
  nextRelease();
});
