import AuthUtil from '@/sheep/api/member/auth';
import safeUni from '@/sheep/helper/uni';
import { createMemberAppContextManager } from './member-app-context-core.mjs';

const contextManager = createMemberAppContextManager({
  read: (key) => safeUni.getStorageSync(key),
  write: (key, value) => safeUni.setStorageSync(key, value),
  remove: (key) => safeUni.removeStorageSync(key),
  bootstrap: (data) => AuthUtil.bootstrap(data),
});

export function resolveMemberAppContext(agentCode) {
  return contextManager.resolve(agentCode);
}

export async function ensureMemberAppContext(agentCode) {
  const context = await resolveMemberAppContext(agentCode);
  return context.token;
}

export function clearMemberAppContext() {
  contextManager.clear();
}
