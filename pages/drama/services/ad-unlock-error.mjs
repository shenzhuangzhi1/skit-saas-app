const AUTH_ERROR_CODES = new Set([
  'AUTH_IDENTITY_MISMATCH',
  'AUTH_SESSION_STALE',
  'AUTH_SESSION_UNVERIFIED',
]);
const SAFE_DIAGNOSTIC_CODES = new Set([
  ...AUTH_ERROR_CODES,
  'NATIVE_AD_FAILED',
  'NATIVE_AD_NO_FILL',
  'NATIVE_AD_TIMEOUT',
  'NATIVE_AD_UNAVAILABLE',
  'NATIVE_PROTOCOL_INVALID',
  'PAGE_ASYNC_GUARD_INVALIDATED',
  'PANGLE_INIT_FAILED',
  'PRIVACY_CONSENT_DECLINED',
  'PRIVACY_CONSENT_REQUIRED',
  'REWARD_REJECTED',
  'REWARD_VERIFY_TIMEOUT',
  'STALE_PAGE_CONTEXT',
  'TAKU_INIT_FAILED',
  'TELEMETRY_DELIVERY_FAILED',
  'TELEMETRY_RETRY_INVALID',
]);
const SAFE_BUSINESS_CODES = new Set([
  '1030007007',
  '1030007008',
  '1030007009',
  '1030007010',
  '1030007011',
  '1030007012',
]);
const SAFE_STAGES = new Set([
  'identity',
  'consent',
  'ownership',
  'entitlements',
  'session',
  'native',
  'verification',
  'playback',
]);

function errorCode(error) {
  return String(error?.code ?? '').trim();
}

export function rewardErrorTitle(error) {
  const message = String(error?.message || error?.msg || '').trim();
  const code = errorCode(error);
  const numericCode = Number(error?.code);

  if (
    message.includes('CLIENT_RUNTIME_HEADERS_INVALID') ||
    message.includes('CLIENT_VERSION_REVOKED')
  ) {
    return '请更新到最新版本后重试';
  }
  if ([1030007007, 1030007008, 1030007009].includes(numericCode)) {
    return '当前剧目正在准备，请稍后重试';
  }
  if (numericCode === 1030007010) {
    return '当前代理商内容授权未配置，请联系代理商';
  }
  if (numericCode === 1030007011) {
    return '当前剧目不在本代理商内容库，请选择其他剧目';
  }
  if (numericCode === 1030007012) {
    return '当前代理商内容授权失效，请联系代理商';
  }
  if (code === 'TELEMETRY_DELIVERY_FAILED') {
    return '广告状态同步失败，请稍后重试';
  }
  if (code === 'NATIVE_AD_NO_FILL') {
    return '当前广告库存不足，请稍后再试';
  }
  if (code === 'PRIVACY_CONSENT_REQUIRED' || code === 'PRIVACY_CONSENT_DECLINED') {
    return '请先同意隐私与广告服务后再观看广告';
  }
  if (code === 'PANGLE_INIT_FAILED') {
    return '内容与广告服务初始化失败，请重启应用后重试';
  }
  if (code === 'TAKU_INIT_FAILED') {
    return '广告服务初始化失败，请稍后重试';
  }
  if (code === 'REWARD_REJECTED' || code === 'REWARD_VERIFY_TIMEOUT') {
    return '本次奖励未到账，请重新观看广告';
  }
  if (AUTH_ERROR_CODES.has(code)) {
    return '登录状态同步中，请稍后重试';
  }
  if (code === '403' || Number(error?.statusCode) === 403) {
    return '当前账号暂无观看权限，请稍后重试';
  }
  if (
    code === '401' ||
    Number(error?.statusCode) === 401 ||
    /登录身份|登录状态|身份尚未同步/.test(message)
  ) {
    return '登录状态同步中，请稍后重试';
  }
  if (code.startsWith('NATIVE_AD_')) {
    return '广告暂不可用，请稍后重试';
  }
  return '服务暂时繁忙，请稍后重试';
}

export function formatUnlockFailure({ stage, error } = {}) {
  const safeStage = SAFE_STAGES.has(stage) ? stage : 'unknown';
  const candidate = String(error?.code ?? error?.statusCode ?? '').trim();
  const safeCode =
    SAFE_DIAGNOSTIC_CODES.has(candidate) ||
    SAFE_BUSINESS_CODES.has(candidate) ||
    /^[1-5][0-9]{2}$/.test(candidate)
      ? candidate
      : 'UNKNOWN';
  return `[ad-unlock] stage=${safeStage} code=${safeCode}`;
}
