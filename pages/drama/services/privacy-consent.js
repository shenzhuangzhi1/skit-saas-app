import { callNativeMethod, getNativePlugin } from './native-bridge';

const PRIVACY_PLUGIN_NAME = 'SkitPrivacyConsent';
const CONSENT_RECORD_VERSION = 1;
const BUILD_PROFILE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

function consentStorageKey(profileCode) {
  const normalizedProfileCode = String(profileCode || '').trim().toUpperCase();
  if (!BUILD_PROFILE_PATTERN.test(normalizedProfileCode)) {
    throw new Error('Android 构建档案标识无效');
  }
  return [
    'skit',
    'ad-privacy-consent',
    `v${CONSENT_RECORD_VERSION}`,
    normalizedProfileCode,
  ].join(':');
}

function promptForAdPrivacyConsent() {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || typeof uni.showModal !== 'function') {
      reject(new Error('当前环境无法展示隐私同意提示'));
      return;
    }
    uni.showModal({
      title: '隐私与广告服务说明',
      content:
        '观看激励广告前，需要启用广告 SDK 以完成广告加载、展示及奖励验证。请先阅读系统设置中的《隐私协议》，同意后再继续。',
      confirmText: '同意并继续',
      cancelText: '暂不同意',
      showCancel: true,
      success: (result) => resolve(result?.confirm === true),
      fail: (error) => reject(error instanceof Error ? error : new Error('隐私同意提示失败')),
    });
  });
}

export async function deliverAdPrivacyConsent(granted) {
  if (typeof granted !== 'boolean') {
    throw new TypeError('Privacy consent must be a boolean supplied by the user flow');
  }
  const plugin = getNativePlugin(PRIVACY_PLUGIN_NAME);
  const result = await callNativeMethod(plugin, 'setAdPrivacyConsent', {
    granted,
    consentVersion: CONSENT_RECORD_VERSION,
  });
  if (
    result?.success !== true ||
    result?.granted !== granted ||
    result?.consentVersion !== CONSENT_RECORD_VERSION
  ) {
    throw new Error('原生隐私同意状态未被接受');
  }
  return true;
}

export function createAdPrivacyConsentGate(options = {}) {
  const getStored = options.getStored || ((key) => uni.getStorageSync(key));
  const setStored = options.setStored || ((key, value) => uni.setStorageSync(key, value));
  const prompt = options.prompt || promptForAdPrivacyConsent;
  const deliver = options.deliver || deliverAdPrivacyConsent;
  const getProfileCode =
    options.getProfileCode ||
    (() => String(import.meta.env?.VITE_SKIT_AGENT_CODE || '').trim().toUpperCase());
  const now = options.now || (() => new Date().toISOString());
  const deliveredProfiles = new Set();
  const inFlightProfiles = new Map();

  async function ensureProfile() {
    const key = consentStorageKey(getProfileCode());
    if (deliveredProfiles.has(key)) {
      return true;
    }
    const stored = getStored(key);
    const accepted =
      stored?.consentVersion === CONSENT_RECORD_VERSION &&
      typeof stored?.acceptedAt === 'string' &&
      Number.isFinite(Date.parse(stored.acceptedAt));
    if (!accepted && !(await prompt({
      title: '隐私与广告服务说明',
      content:
        '观看激励广告前，需要启用广告 SDK 以完成广告加载、展示及奖励验证。请先阅读系统设置中的《隐私协议》，同意后再继续。',
    }))) {
      return false;
    }
    await deliver(true);
    if (!accepted) {
      setStored(key, {
        consentVersion: CONSENT_RECORD_VERSION,
        acceptedAt: now(),
      });
    }
    deliveredProfiles.add(key);
    return true;
  }

  return Object.freeze({
    ensure() {
      const key = consentStorageKey(getProfileCode());
      const existing = inFlightProfiles.get(key);
      if (existing) {
        return existing;
      }
      const pending = ensureProfile().finally(() => inFlightProfiles.delete(key));
      inFlightProfiles.set(key, pending);
      return pending;
    },
  });
}

const adPrivacyConsentGate = createAdPrivacyConsentGate();

export function ensureAdPrivacyConsent(identity) {
  return adPrivacyConsentGate.ensure(identity);
}
