import { callNativeMethod, getNativePlugin } from './native-bridge';
import { cacheExternalDramas } from '@/pages/drama/data';

const PANGLE_PLUGIN_NAME = 'SkitPangleDrama';
const DEFAULT_SETTING_FILE = import.meta.env?.VITE_PANGLE_DRAMA_SETTING_FILE || 'SDK_Setting.json';
const DEFAULT_FREE_SET = Number(import.meta.env?.VITE_PANGLE_DRAMA_FREE_SET || 8);
const DEFAULT_LOCK_SET = Number(import.meta.env?.VITE_PANGLE_DRAMA_LOCK_SET || 5);
const DEFAULT_PAGE_SIZE = Number(import.meta.env?.VITE_PANGLE_DRAMA_PAGE_SIZE || 24);
let startPromise;

export function isPangleContentReady() {
  const plugin = getNativePlugin(PANGLE_PLUGIN_NAME);
  return !!plugin && typeof plugin.openPlayer === 'function';
}

function getPanglePlugin() {
  return getNativePlugin(PANGLE_PLUGIN_NAME);
}

export async function startPangleContentSdk(options = {}) {
  const plugin = getPanglePlugin();
  if (!plugin || typeof plugin.start !== 'function') {
    return { skipped: true, reason: 'pangle-plugin-missing' };
  }

  if (!startPromise) {
    startPromise = callNativeMethod(
      plugin,
      'start',
      {
        settingFile: options.settingFile || DEFAULT_SETTING_FILE,
        debug: options.debug ?? import.meta.env?.MODE !== 'production',
      },
      { timeoutMs: 30000 },
    ).catch((error) => {
      startPromise = null;
      throw error;
    });
  }

  const result = await startPromise;
  if (result?.success === false) {
    throw new Error(result.message || '穿山甲短剧 SDK 启动失败');
  }
  return result;
}

function makeEpisodes(total) {
  return Array.from({ length: Math.max(1, Number(total) || 1) }, (_, index) => ({
    episode: index + 1,
    title: `第${index + 1}集`,
    duration: '',
    videoUrl: '',
  }));
}

function getPositiveDramaId(drama = {}) {
  const rawId = drama.pangleDramaId ?? drama.contentId ?? drama.nativeId ?? drama.id;
  const numericId = Number(rawId);
  return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
}

function normalizePlayerGrant(playerGrant, dramaId) {
  if (
    !playerGrant ||
    !Number.isSafeInteger(Number(playerGrant.grantId)) ||
    Number(playerGrant.grantId) <= 0 ||
    Number(playerGrant.dramaId) !== dramaId ||
    typeof playerGrant.grantToken !== 'string' ||
    !/^[A-Za-z0-9_-]{22,256}$/.test(playerGrant.grantToken) ||
    !playerGrant.expiresAt
  ) {
    throw new Error('服务端播放器权限无效');
  }
  return {
    grantId: Number(playerGrant.grantId),
    dramaId,
    expiresAt: playerGrant.expiresAt,
    grantToken: playerGrant.grantToken,
  };
}

export function hasPangleDramaId(drama = {}) {
  return getPositiveDramaId(drama) !== null;
}

export function normalizePangleDrama(raw = {}) {
  const rawId = raw.id ?? raw.drama_id ?? raw.dramaId ?? raw.dramaID;
  if (rawId === undefined || rawId === null || rawId === '') {
    return null;
  }

  const total = Number(raw.total || raw.episodeCount || raw.count || 1) || 1;
  const category = raw.type || raw.category || '热播';
  const coverImage = raw.coverImage || raw.cover_image || raw.cover || raw.poster || '';

  return {
    id: String(rawId),
    pangleDramaId: rawId,
    contentId: rawId,
    source: 'pangle-drama-sdk',
    title: raw.title || raw.scriptName || '穿山甲短剧',
    category,
    tags: [category].filter(Boolean),
    total,
    freeEpisodes: Number(raw.freeSet || raw.free_set || DEFAULT_FREE_SET),
    unlockSize: Number(raw.lockSet || raw.lock_set || DEFAULT_LOCK_SET),
    status: Number(raw.status) === 1 ? '连载中' : '已完结',
    heat: raw.heat || raw.hot || '穿山甲内容',
    follows: raw.follows || '',
    score: raw.score || '9.0',
    updateText: '',
    cover: coverImage
      ? `url("${coverImage}") center/cover`
      : 'linear-gradient(155deg, #111827 0%, #374151 52%, #f97316 100%)',
    accent: '#ff5a1f',
    desc: raw.desc || raw.description || '',
    lines: [raw.desc || raw.description || ''],
    episodes: makeEpisodes(total),
    raw,
  };
}

export async function openPangleDramaPlayer(options = {}) {
  const plugin = getPanglePlugin();
  if (!plugin || typeof plugin.openPlayer !== 'function') {
    return { skipped: true, reason: 'pangle-plugin-missing' };
  }

  await startPangleContentSdk(options);
  const drama = options.drama || {};
  const dramaId = getPositiveDramaId(drama);
  if (!dramaId) {
    return { skipped: true, reason: 'pangle-drama-id-missing' };
  }
  const playerGrant = normalizePlayerGrant(options.playerGrant, dramaId);
  return callNativeMethod(
    plugin,
    'openPlayer',
    {
      dramaId,
      episode: options.episode || 1,
      progress: options.progress || 0,
      source: options.source || 'drama_page',
      settingFile: options.settingFile || DEFAULT_SETTING_FILE,
      playerGrant,
    },
    { timeoutMs: 10000 },
  );
}

export async function openDirectDramaPlayer(drama, episode = 1, source = 'drama_card') {
  if (!hasPangleDramaId(drama)) {
    uni.showToast({
      title: '真实播放器暂不可用',
      icon: 'none',
    });
    return false;
  }
  uni.navigateTo({
    url: `/pages/drama/play?id=${encodeURIComponent(String(drama.id))}&episode=${Math.max(
      1,
      Number(episode) || 1,
    )}&source=${encodeURIComponent(source)}`,
  });
  return true;
}

export async function getPangleDramaList(params = {}) {
  const plugin = getPanglePlugin();
  if (!plugin || typeof plugin.list !== 'function') {
    return { skipped: true, list: [] };
  }

  await startPangleContentSdk(params);
  const method =
    params.category && typeof plugin.listWithCategory === 'function' ? 'listWithCategory' : 'list';
  const result = await callNativeMethod(
    plugin,
    method,
    {
      category: params.category || '',
      page: params.page || 1,
      count: params.count || params.pageSize || DEFAULT_PAGE_SIZE,
      order: params.order ?? true,
    },
    { timeoutMs: 20000 },
  );

  const rawList = Array.isArray(result) ? result : Array.isArray(result.list) ? result.list : [];
  const list = rawList.map(normalizePangleDrama).filter(Boolean);
  if (list.length > 0) {
    cacheExternalDramas(list);
  }

  return {
    skipped: false,
    list,
    raw: result,
  };
}

export async function getPangleDramaCategories() {
  const plugin = getPanglePlugin();
  if (!plugin || typeof plugin.categoryList !== 'function') {
    return { skipped: true, list: [] };
  }

  await startPangleContentSdk();
  const result = await callNativeMethod(plugin, 'categoryList', {}, { timeoutMs: 20000 });
  return {
    skipped: false,
    list: Array.isArray(result) ? result : Array.isArray(result.list) ? result.list : [],
    raw: result,
  };
}
