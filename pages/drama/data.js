const HISTORY_KEY = 'skit_drama_history_v1';
const FOLLOW_KEY = 'skit_drama_follow_v1';
const EXTERNAL_DRAMA_CACHE_KEY = 'skit_external_drama_cache_v1';
const MEMBER_SCOPE_KEY = 'skit_drama_member_scope_v1';
const SCOPE_PART_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function readStorage(key, fallback) {
  try {
    return uni.getStorageSync(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    uni.setStorageSync(key, value);
  } catch (error) {
    // Storage can be unavailable in a few embedded previews. Ignore it.
  }
}

function normalizeScopePart(value) {
  const normalized = String(value ?? '').trim();
  return SCOPE_PART_PATTERN.test(normalized) ? normalized : '';
}

function activeTenantScope() {
  return normalizeScopePart(readStorage('tenant-id', '')) || 'default';
}

function tenantStorageKey(baseKey) {
  return `${baseKey}:tenant:${activeTenantScope()}`;
}

function personalStorageKey(baseKey) {
  const activeTenantId = activeTenantScope();
  const rawMemberScope = String(readStorage(MEMBER_SCOPE_KEY, ''));
  const [tenantId, memberId, ...extra] = rawMemberScope.split(':');
  if (
    extra.length === 0 &&
    tenantId === activeTenantId &&
    SCOPE_PART_PATTERN.test(tenantId) &&
    SCOPE_PART_PATTERN.test(memberId)
  ) {
    return `${baseKey}:member:${tenantId}:${memberId}`;
  }
  return `${baseKey}:guest:${activeTenantId}`;
}

export function setDramaMemberScope(identity = {}) {
  const tenantId = normalizeScopePart(identity.tenantId);
  const memberId = normalizeScopePart(identity.memberId ?? identity.userId ?? identity.id);
  if (!tenantId || !memberId) {
    return false;
  }
  writeStorage(MEMBER_SCOPE_KEY, `${tenantId}:${memberId}`);
  return true;
}

export function clearDramaMemberScope() {
  try {
    uni.removeStorageSync(MEMBER_SCOPE_KEY);
  } catch {
    // Storage can be unavailable in embedded previews.
  }
}

export function getExternalDramas() {
  const list = readStorage(tenantStorageKey(EXTERNAL_DRAMA_CACHE_KEY), []);
  return Array.isArray(list) ? list : [];
}

export function cacheExternalDramas(list = []) {
  const validList = Array.isArray(list) ? list.filter((item) => item && item.id) : [];
  if (validList.length === 0) {
    return getExternalDramas();
  }

  const merged = [...getExternalDramas(), ...validList].reduce((map, item) => {
    map.set(String(item.id), item);
    return map;
  }, new Map());
  const next = Array.from(merged.values()).slice(0, 120);
  writeStorage(tenantStorageKey(EXTERNAL_DRAMA_CACHE_KEY), next);
  return next;
}

export function getDramaById(id) {
  const targetId = String(id || '');
  return getExternalDramas().find((item) => String(item.id) === targetId) || null;
}

export function getHotDramas(limit = 72) {
  return getExternalDramas().slice(0, limit);
}

export function getDramasByCategory(category) {
  if (!category || category === '全部' || category === '热播') {
    return getHotDramas();
  }
  return getExternalDramas().filter((item) => item.category === category);
}

export function getRecommendDrama() {
  return getHotDramas(1)[0] || null;
}

export function saveHistory(id, episode = 1) {
  const drama = getDramaById(id);
  if (!drama) {
    return;
  }
  const safeEpisode = Math.max(1, Math.min(Number(episode) || 1, drama.total));
  const normalizedId = String(id);
  const history = readStorage(personalStorageKey(HISTORY_KEY), []).filter(
    (item) => String(item.id) !== normalizedId,
  );
  history.unshift({
    id: normalizedId,
    episode: safeEpisode,
    total: drama.total,
    watchedAt: Date.now(),
  });
  writeStorage(personalStorageKey(HISTORY_KEY), history.slice(0, 30));
}

export function getHistoryList() {
  const history = readStorage(personalStorageKey(HISTORY_KEY), []);
  return (Array.isArray(history) ? history : [])
    .map((item) => ({
      ...item,
      drama: getDramaById(item.id),
    }))
    .filter((item) => item.drama);
}

export function getFollowIds() {
  const follows = readStorage(personalStorageKey(FOLLOW_KEY), []);
  return Array.isArray(follows) ? follows.map((id) => String(id)) : [];
}

export function isFollowed(id) {
  return getFollowIds().includes(String(id));
}

export function toggleFollow(id) {
  const normalizedId = String(id);
  const follows = getFollowIds();
  const exists = follows.includes(normalizedId);
  const next = exists
    ? follows.filter((item) => item !== normalizedId)
    : [normalizedId, ...follows];
  writeStorage(personalStorageKey(FOLLOW_KEY), next);
  return !exists;
}

export function getFollowList() {
  const histories = getHistoryList().reduce((map, item) => {
    map[item.id] = item.episode;
    return map;
  }, {});
  return getFollowIds()
    .map((id) => ({
      id,
      episode: histories[id] || 1,
      drama: getDramaById(id),
    }))
    .filter((item) => item.drama);
}

export function isEpisodeUnlocked(drama, episode, grantedEpisodeNos = []) {
  if (!drama) {
    return false;
  }
  const safeEpisode = Number(episode) || 1;
  const serverGranted = Array.isArray(grantedEpisodeNos) ? grantedEpisodeNos : [];
  return safeEpisode <= drama.freeEpisodes || serverGranted.includes(safeEpisode);
}

export function getUnlockRange(drama, startEpisode, grantedEpisodeNos = []) {
  if (!drama) {
    return [];
  }
  const serverGranted = Array.isArray(grantedEpisodeNos) ? grantedEpisodeNos : [];
  const range = [];
  for (let episode = Number(startEpisode) || 1; episode <= drama.total; episode += 1) {
    if (episode <= drama.freeEpisodes || serverGranted.includes(episode)) {
      continue;
    }
    range.push(episode);
    if (range.length >= drama.unlockSize) {
      break;
    }
  }
  return range;
}
