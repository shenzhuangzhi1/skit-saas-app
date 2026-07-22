const PHASES = new Set(['IDLE', 'LAUNCHING', 'PRESENTED', 'RETURNED', 'FAILED']);

export function transitionNativePlayerPhase(currentPhase, event) {
  const current = PHASES.has(currentPhase) ? currentPhase : 'IDLE';
  if (event === 'RESET') {
    return 'IDLE';
  }
  if (event === 'LAUNCH') {
    return 'LAUNCHING';
  }
  if (event === 'ACK') {
    return current === 'LAUNCHING' ? 'PRESENTED' : current;
  }
  if (event === 'RETURN') {
    return current === 'LAUNCHING' || current === 'PRESENTED' ? 'RETURNED' : current;
  }
  if (event === 'FAIL') {
    return current === 'LAUNCHING' ? 'FAILED' : current;
  }
  return current;
}

export function nativePlayerPlaceholderCopy(ready, phase) {
  if (!ready) {
    return {
      title: '当前剧集暂不可播放',
      description: '请稍后再试',
    };
  }
  if (phase === 'LAUNCHING') {
    return {
      title: '正在启动播放器',
      description: '请稍候',
    };
  }
  if (phase === 'PRESENTED') {
    return {
      title: '播放器正在运行',
      description: '返回后可重新打开',
    };
  }
  if (phase === 'RETURNED') {
    return {
      title: '播放器已返回',
      description: '点击下方重新打开',
    };
  }
  if (phase === 'FAILED') {
    return {
      title: '播放器启动失败',
      description: '点击下方重试',
    };
  }
  return {
    title: '原生播放器可用',
    description: '点击下方开始播放',
  };
}
