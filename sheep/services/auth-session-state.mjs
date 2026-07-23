function validEpoch(value) {
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : undefined;
}

export function nextAuthSessionEpoch(currentEpoch) {
  const current = validEpoch(currentEpoch);
  if (current === undefined || current >= Number.MAX_SAFE_INTEGER) {
    return 1;
  }
  return current + 1;
}

export function authEpochMatches(expectedEpoch, currentEpoch) {
  const expected = validEpoch(expectedEpoch);
  const current = validEpoch(currentEpoch);
  return expected !== undefined && current !== undefined && expected === current;
}

export function normalizeAuthIdentity(value = {}) {
  return {
    memberId: String(value.memberId ?? value.userId ?? value.id ?? '').trim(),
    tenantId: String(value.tenantId ?? '').trim(),
  };
}

export function authIdentityMatches(expected, actual) {
  const left = normalizeAuthIdentity(expected);
  const right = normalizeAuthIdentity(actual);
  return (
    Boolean(left.memberId) &&
    Boolean(left.tenantId) &&
    left.memberId === right.memberId &&
    left.tenantId === right.tenantId
  );
}
