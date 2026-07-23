export const MEMBER_APP_CONTEXT_KEY = 'skit-member-app-context';
export const MEMBER_TENANT_KEY = 'tenant-id';

const RENEWAL_WINDOW_MS = 60 * 1000;

function normalizeAgentCode(agentCode) {
  return String(agentCode || '')
    .trim()
    .toUpperCase();
}

function normalizeTenantId(value) {
  const tenantId = Number(value);
  return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : 0;
}

function readExpiresTime(value) {
  const expiresTime = new Date(value || 0).getTime();
  return Number.isFinite(expiresTime) ? expiresTime : 0;
}

function normalizeContext(value, agentCode, now) {
  const token = String(value?.token || '').trim();
  const tenantId = normalizeTenantId(value?.tenantId);
  const expiresTime = readExpiresTime(value?.expiresTime);
  if (
    value?.agentCode !== agentCode ||
    !token ||
    !tenantId ||
    expiresTime <= now + RENEWAL_WINDOW_MS
  ) {
    return null;
  }
  return Object.freeze({ agentCode, token, tenantId, expiresTime });
}

export function createMemberAppContextManager({
  read,
  write,
  remove,
  bootstrap,
  now = () => Date.now(),
}) {
  if (
    typeof read !== 'function' ||
    typeof write !== 'function' ||
    typeof remove !== 'function' ||
    typeof bootstrap !== 'function'
  ) {
    throw new TypeError('member app context storage and bootstrap dependencies are required');
  }
  const flights = new Map();

  function persist(context) {
    write(MEMBER_APP_CONTEXT_KEY, context);
    write(MEMBER_TENANT_KEY, context.tenantId);
    return context;
  }

  async function resolve(agentCode) {
    const code = normalizeAgentCode(agentCode);
    if (!code) {
      throw new Error('请从代理商 App 或邀请链接进入');
    }
    const cached = normalizeContext(read(MEMBER_APP_CONTEXT_KEY), code, now());
    if (cached) {
      return persist(cached);
    }
    if (flights.has(code)) {
      return flights.get(code);
    }

    const flight = (async () => {
      const result = await bootstrap({ agentCode: code });
      if (result?.code !== 0) {
        throw new Error(result?.msg || '代理商入口不可用');
      }
      const data = result?.data || {};
      const context = normalizeContext(
        {
          agentCode: code,
          token: data.token,
          tenantId: data.tenantId,
          expiresTime: data.expiresTime,
        },
        code,
        now(),
      );
      if (!context) {
        throw new Error('代理商登录上下文无效，请重新进入 App');
      }
      return persist(context);
    })();
    flights.set(code, flight);
    try {
      return await flight;
    } finally {
      if (flights.get(code) === flight) {
        flights.delete(code);
      }
    }
  }

  return Object.freeze({
    resolve,
    clear() {
      remove(MEMBER_APP_CONTEXT_KEY);
    },
  });
}
