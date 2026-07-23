import {
  authIdentityMatches,
  normalizeAuthIdentity,
} from '../../sheep/services/auth-session-state.mjs';

function sanitizePath(url) {
  const queryFreeUrl = String(url || '-').split(/[?#]/, 1)[0];
  const path = queryFreeUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  if (!path.startsWith('/')) {
    return '-';
  }
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => (/^[a-z_-]{1,40}$/i.test(segment) ? segment : 'redacted'));
  return segments.length ? `/${segments.join('/')}` : '/';
}

export function formatAuthFailure({ stage, httpStatus, code, url }) {
  const safeStage = String(stage || 'unknown').replace(/[^a-z0-9-]/gi, '-');
  const safeHttpStatus = String(httpStatus ?? 'unknown').replace(/[^a-z0-9_-]/gi, '');
  const safeCode = String(code ?? 'unknown').replace(/[^a-z0-9_-]/gi, '');
  const path = sanitizePath(url);
  return `[auth] ${safeStage} http=${safeHttpStatus || 'unknown'} code=${
    safeCode || 'unknown'
  } path=${path}`;
}

function authCompletionError(code) {
  const error = new Error('登录会话校验失败，请重试');
  error.code = code;
  return error;
}

export async function completeMemberAuth({
  authenticate,
  captureSession,
  hydrateProfile,
  validateSession,
}) {
  const result = await authenticate();
  if (result?.code !== 0) {
    return { ok: false, result };
  }

  const expectedIdentity = normalizeAuthIdentity(result?.data);
  if (!result?.data?.accessToken || !expectedIdentity.memberId || !expectedIdentity.tenantId) {
    throw authCompletionError('AUTH_SESSION_UNVERIFIED');
  }
  const session = captureSession?.(result);
  const profile = await hydrateProfile(session);
  const profileIdentity = normalizeAuthIdentity(profile);
  if (!profileIdentity.memberId || !profileIdentity.tenantId) {
    throw authCompletionError('AUTH_SESSION_UNVERIFIED');
  }
  if (!authIdentityMatches(expectedIdentity, profileIdentity)) {
    throw authCompletionError('AUTH_IDENTITY_MISMATCH');
  }
  if (validateSession && !validateSession(session)) {
    throw authCompletionError('AUTH_SESSION_STALE');
  }

  return { ok: true, result, profile, session };
}
