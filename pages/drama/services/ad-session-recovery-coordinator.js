function requireScope(scope) {
  const tenantId = String(scope?.tenantId ?? '').trim();
  const memberId = String(scope?.memberId ?? '').trim();
  const dramaId = Number(scope?.dramaId);
  const episodeNo = Number(scope?.episodeNo);
  if (!tenantId || !memberId) {
    throw new Error('待验证广告会话缺少当前租户或会员 identity');
  }
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) {
    throw new Error('待验证广告会话缺少有效短剧编号');
  }
  if (!Number.isSafeInteger(episodeNo) || episodeNo <= 0) {
    throw new Error('待验证广告会话缺少有效剧集编号');
  }
  return Object.freeze({ tenantId, memberId, dramaId, episodeNo });
}

function scopeKey(scope) {
  const normalized = requireScope(scope);
  return JSON.stringify([
    normalized.tenantId,
    normalized.memberId,
    normalized.dramaId,
    normalized.episodeNo,
  ]);
}

function recoveryKey(scope, sessionIdInput) {
  const sessionId = String(sessionIdInput ?? '').trim();
  if (!sessionId) {
    throw new Error('待验证广告恢复缺少 session');
  }
  return JSON.stringify([scopeKey(scope), sessionId]);
}

export function createAdSessionRecoveryCoordinator() {
  const recoveryPromises = new Map();
  const activeOwners = new Set();
  const queuedRecoveries = new Map();
  const scopeRecoveries = new Map();

  function startRecovery(scope, sessionId, recover) {
    const ownerKey = scopeKey(scope);
    const key = recoveryKey(scope, sessionId);
    let tracked;
    tracked = Promise.resolve()
      .then(recover)
      .finally(() => {
        if (recoveryPromises.get(key) === tracked) {
          recoveryPromises.delete(key);
        }
        const running = scopeRecoveries.get(ownerKey);
        running?.delete(tracked);
        if (running?.size === 0) {
          scopeRecoveries.delete(ownerKey);
        }
      });
    recoveryPromises.set(key, tracked);
    const running = scopeRecoveries.get(ownerKey) || new Set();
    running.add(tracked);
    scopeRecoveries.set(ownerKey, running);
    return tracked;
  }

  async function acquire(scope) {
    const key = scopeKey(scope);
    while (scopeRecoveries.has(key)) {
      await Promise.allSettled([...scopeRecoveries.get(key)]);
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
      for (const [queuedKey, queued] of queuedRecoveries) {
        if (queued.scopeKey !== key) {
          continue;
        }
        queuedRecoveries.delete(queuedKey);
        startRecovery(queued.scope, queued.sessionId, queued.recover).then(
          queued.resolve,
          queued.reject,
        );
      }
    };
  }

  function runRecovery(scope, sessionId, recover) {
    const ownerKey = scopeKey(scope);
    const key = recoveryKey(scope, sessionId);
    const existing = recoveryPromises.get(key);
    if (existing) {
      return existing;
    }
    if (typeof recover !== 'function') {
      return Promise.reject(new Error('待验证广告恢复方法不可用'));
    }
    if (activeOwners.has(ownerKey)) {
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
      queuedRecoveries.set(key, {
        scope: requireScope(scope),
        scopeKey: ownerKey,
        sessionId: String(sessionId),
        recover,
        promise,
        resolve,
        reject,
      });
      return promise;
    }
    return startRecovery(scope, sessionId, recover);
  }

  return Object.freeze({ acquire, runRecovery });
}
