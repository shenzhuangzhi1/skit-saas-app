function normalizeScope(scope) {
  const tenantId = String(scope?.tenantId ?? '').trim();
  const memberId = String(scope?.memberId ?? '').trim();
  const dramaId = Number(scope?.dramaId);
  if (!tenantId || tenantId === 'undefined' || tenantId === 'null') {
    throw new Error('页面异步上下文缺少租户 identity');
  }
  if (!memberId || memberId === 'undefined' || memberId === 'null') {
    throw new Error('页面异步上下文缺少会员 identity');
  }
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) {
    throw new Error('页面异步上下文缺少有效短剧编号');
  }
  return Object.freeze({ tenantId, memberId, dramaId });
}

function normalizeChannel(channel) {
  const value = String(channel ?? '').trim();
  if (!value || value.length > 256) {
    throw new Error('页面异步请求通道无效');
  }
  return value;
}

export function createDramaPageAsyncGuard() {
  let active = false;
  let visible = false;
  let pageGeneration = 0;
  let presentationDepth = 0;
  const requestGenerations = new Map();
  const uiWaiters = new Set();

  function invalidatedError() {
    const error = new Error('页面异步上下文已经失效');
    error.code = 'PAGE_ASYNC_GUARD_INVALIDATED';
    return error;
  }

  function rejectWaiters(predicate = () => true) {
    for (const waiter of [...uiWaiters]) {
      if (!predicate(waiter)) {
        continue;
      }
      uiWaiters.delete(waiter);
      waiter.reject(invalidatedError());
    }
  }

  function flushUiWaiters() {
    if (!active || !visible || presentationDepth > 0) {
      return;
    }
    for (const waiter of [...uiWaiters]) {
      uiWaiters.delete(waiter);
      if (isCurrent(waiter.request, waiter.scope)) {
        waiter.resolve();
      } else {
        waiter.reject(invalidatedError());
      }
    }
  }

  function activate() {
    if (!active) {
      active = true;
      pageGeneration += 1;
      requestGenerations.clear();
    }
    return pageGeneration;
  }

  function deactivate() {
    visible = false;
    if (!active) {
      rejectWaiters();
      return;
    }
    active = false;
    pageGeneration += 1;
    requestGenerations.clear();
    rejectWaiters();
  }

  function invalidateRequests() {
    pageGeneration += 1;
    requestGenerations.clear();
    rejectWaiters();
  }

  function invalidateChannel(channelInput) {
    const channel = normalizeChannel(channelInput);
    requestGenerations.set(channel, (requestGenerations.get(channel) || 0) + 1);
    rejectWaiters((waiter) => waiter.request?.channel === channel);
  }

  function begin(channelInput, scopeInput) {
    if (!active) {
      throw new Error('页面已经离开，不能启动新的异步请求');
    }
    const channel = normalizeChannel(channelInput);
    const scope = normalizeScope(scopeInput);
    rejectWaiters((waiter) => waiter.request?.channel === channel);
    const requestGeneration = (requestGenerations.get(channel) || 0) + 1;
    requestGenerations.set(channel, requestGeneration);
    return Object.freeze({
      ...scope,
      channel,
      pageGeneration,
      requestGeneration,
    });
  }

  function isCurrent(request, scopeInput) {
    if (!active || !request || request.pageGeneration !== pageGeneration) {
      return false;
    }
    let scope;
    try {
      scope = normalizeScope(scopeInput);
    } catch (error) {
      return false;
    }
    return (
      requestGenerations.get(request.channel) === request.requestGeneration &&
      request.tenantId === scope.tenantId &&
      request.memberId === scope.memberId &&
      request.dramaId === scope.dramaId
    );
  }

  function setVisible(nextVisible) {
    visible = nextVisible === true;
    flushUiWaiters();
  }

  function beginPresentation() {
    if (!active) {
      throw invalidatedError();
    }
    presentationDepth += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      presentationDepth = Math.max(0, presentationDepth - 1);
      flushUiWaiters();
    };
  }

  function isPresenting() {
    return presentationDepth > 0;
  }

  function isVisible() {
    return active && visible;
  }

  function isUiCurrent(request, scopeInput) {
    return visible && presentationDepth === 0 && isCurrent(request, scopeInput);
  }

  function waitForUi(request, scopeInput) {
    let scope;
    try {
      scope = normalizeScope(scopeInput);
    } catch (error) {
      return Promise.reject(invalidatedError());
    }
    if (!isCurrent(request, scope)) {
      return Promise.reject(invalidatedError());
    }
    if (isUiCurrent(request, scope)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      uiWaiters.add({ request, scope, resolve, reject });
    });
  }

  return Object.freeze({
    activate,
    deactivate,
    invalidateRequests,
    invalidateChannel,
    begin,
    isCurrent,
    setVisible,
    beginPresentation,
    isPresenting,
    isVisible,
    isUiCurrent,
    waitForUi,
  });
}
