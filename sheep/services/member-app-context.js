import AuthUtil from '@/sheep/api/member/auth';
import safeUni from '@/sheep/helper/uni';

const CONTEXT_KEY = 'skit-member-app-context';
const RENEWAL_WINDOW_MS = 60 * 1000;

function normalizeAgentCode(agentCode) {
  return String(agentCode || '')
    .trim()
    .toUpperCase();
}

function readExpiresTime(value) {
  const expiresTime = new Date(value || 0).getTime();
  return Number.isFinite(expiresTime) ? expiresTime : 0;
}

export async function ensureMemberAppContext(agentCode) {
  const code = normalizeAgentCode(agentCode);
  if (!code) {
    throw new Error('请从代理商 App 或邀请链接进入');
  }

  const cached = safeUni.getStorageSync(CONTEXT_KEY);
  if (
    cached?.agentCode === code &&
    cached?.token &&
    Number(cached.expiresTime) > Date.now() + RENEWAL_WINDOW_MS
  ) {
    return cached.token;
  }

  const result = await AuthUtil.bootstrap({ agentCode: code });
  if (result?.code !== 0 || !result?.data?.token) {
    throw new Error(result?.msg || '代理商入口不可用');
  }

  const expiresTime = readExpiresTime(result.data.expiresTime);
  if (expiresTime <= Date.now() + RENEWAL_WINDOW_MS) {
    throw new Error('代理商登录上下文已失效，请重新进入 App');
  }
  safeUni.setStorageSync(CONTEXT_KEY, {
    agentCode: code,
    token: result.data.token,
    expiresTime,
  });
  return result.data.token;
}

export function clearMemberAppContext() {
  safeUni.removeStorageSync(CONTEXT_KEY);
}
