function identityKey(identity) {
  const tenantId = String(identity?.tenantId ?? '').trim();
  const memberId = String(identity?.memberId ?? '').trim();
  if (!tenantId || !memberId) {
    throw new Error('待验证广告会话缺少当前租户或会员 identity');
  }
  return JSON.stringify([tenantId, memberId]);
}

export function createAdSessionRecoveryCoordinator() {
  const recoveryPromises = new Map();
  const activeOwners = new Set();
  const queuedRecoveries = new Map();

  function startRecovery(key, recover) {
    let tracked;
    tracked = Promise.resolve()
      .then(recover)
      .finally(() => {
        if (recoveryPromises.get(key) === tracked) {
          recoveryPromises.delete(key);
        }
      });
    recoveryPromises.set(key, tracked);
    return tracked;
  }

  async function acquire(identity) {
    const key = identityKey(identity);
    while (recoveryPromises.has(key)) {
      try {
        await recoveryPromises.get(key);
      } catch (error) {
        // A failed foreground recovery must settle before a user-owned unlock retries the API.
      }
    }
    if (activeOwners.has(key)) {
      return null;
    }
    activeOwners.add(key);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      activeOwners.delete(key);
      const queued = queuedRecoveries.get(key);
      if (queued) {
        queuedRecoveries.delete(key);
        startRecovery(key, queued.recover).then(queued.resolve, queued.reject);
      }
    };
  }

  function runRecovery(identity, recover) {
    const key = identityKey(identity);
    const existing = recoveryPromises.get(key);
    if (existing) {
      return existing;
    }
    if (typeof recover !== 'function') {
      return Promise.reject(new Error('待验证广告恢复方法不可用'));
    }
    if (activeOwners.has(key)) {
      const queued = queuedRecoveries.get(key);
      if (queued) {
        return queued.promise;
      }
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      queuedRecoveries.set(key, { recover, promise, resolve, reject });
      return promise;
    }
    return startRecovery(key, recover);
  }

  return Object.freeze({ acquire, runRecovery });
}
