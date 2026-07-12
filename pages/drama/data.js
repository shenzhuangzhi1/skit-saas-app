const HISTORY_KEY = 'skit_drama_history_v1';
const FOLLOW_KEY = 'skit_drama_follow_v1';
const UNLOCK_KEY = 'skit_drama_unlock_v1';
const EXTERNAL_DRAMA_CACHE_KEY = 'skit_external_drama_cache_v1';
const REQUIRE_REAL_CONTENT = import.meta.env?.VITE_DRAMA_REAL_CONTENT_REQUIRED === 'true';

export const DRAMA_CATEGORIES = ['全部', '热播', '逆袭', '甜宠', '都市', '悬疑', '古装'];

function makeEpisodes(total, highlights = [], videoUrls = []) {
  return Array.from({ length: total }, (_, index) => {
    const episode = index + 1;
    return {
      episode,
      title: highlights[index] || `第${episode}集`,
      duration: episode % 3 === 0 ? '01:28' : episode % 3 === 1 ? '01:12' : '01:45',
      videoUrl: videoUrls[index] || '',
    };
  });
}

export const DRAMAS = [
  {
    id: 'reborn-business-queen',
    title: '重生后我在商界封神',
    category: '逆袭',
    tags: ['重生', '商战', '爽感'],
    total: 36,
    freeEpisodes: 6,
    unlockSize: 4,
    status: '连载中',
    heat: '982.4万',
    follows: '18.2万',
    score: '9.3',
    updateText: '每日18:00更新',
    cover: 'linear-gradient(155deg, #1d1028 0%, #7a2533 48%, #ff7a1a 100%)',
    accent: '#ff6b2a',
    desc: '她被合伙人夺走一切，重回签约前夜，用一纸合同翻盘整座商界。',
    lines: ['这一次，股权必须写在我名下。', '他们欠我的，我会一集一集拿回来。'],
    episodes: makeEpisodes(36, ['回到签约前夜', '第一份反击合同', '董事会上的底牌']),
  },
  {
    id: 'flash-marriage-ceo',
    title: '闪婚后总裁每天求公开',
    category: '甜宠',
    tags: ['闪婚', '总裁', '高甜'],
    total: 48,
    freeEpisodes: 8,
    unlockSize: 5,
    status: '已完结',
    heat: '814.9万',
    follows: '15.7万',
    score: '9.1',
    updateText: '全集上线',
    cover: 'linear-gradient(155deg, #fff0e4 0%, #f16c5b 48%, #34162f 100%)',
    accent: '#f0524f',
    desc: '一场合约婚姻，两个人都以为只是合作，却在热搜里越演越真。',
    lines: ['太太，今天也不打算给我名分吗？', '合约里没写这一条。'],
    episodes: makeEpisodes(48, ['民政局偶遇', '合约第一天', '热搜失控']),
  },
  {
    id: 'night-city-detective',
    title: '夜城十二点',
    category: '悬疑',
    tags: ['悬疑', '反转', '刑侦'],
    total: 30,
    freeEpisodes: 5,
    unlockSize: 3,
    status: '连载中',
    heat: '701.6万',
    follows: '11.9万',
    score: '9.0',
    updateText: '周一至周五更新',
    cover: 'linear-gradient(155deg, #051923 0%, #126782 48%, #f8c630 100%)',
    accent: '#f8c630',
    desc: '十二点后出现的匿名短信，把失踪案、旧码头和一场豪门婚礼连在一起。',
    lines: ['短信不是预告，是倒计时。', '每个人都在撒谎，除了那通电话。'],
    episodes: makeEpisodes(30, ['午夜短信', '旧码头证人', '婚礼前的录音']),
  },
  {
    id: 'imperial-doctor',
    title: '医妃她不装了',
    category: '古装',
    tags: ['古装', '医术', '权谋'],
    total: 42,
    freeEpisodes: 7,
    unlockSize: 4,
    status: '已完结',
    heat: '646.2万',
    follows: '9.8万',
    score: '8.9',
    updateText: '全集上线',
    cover: 'linear-gradient(155deg, #132a13 0%, #4f772d 48%, #f4d35e 100%)',
    accent: '#9ec44d',
    desc: '她凭一手银针入局朝堂，救的是病人，拆的是满城权谋。',
    lines: ['这毒不难解，难解的是人心。', '王爷若信我，今晚别喝那杯酒。'],
    episodes: makeEpisodes(42, ['冷宫验毒', '银针入局', '夜审太医署']),
  },
  {
    id: 'startup-heir',
    title: '摊牌了我是集团继承人',
    category: '都市',
    tags: ['都市', '身份', '逆转'],
    total: 40,
    freeEpisodes: 6,
    unlockSize: 4,
    status: '连载中',
    heat: '593.3万',
    follows: '8.6万',
    score: '8.8',
    updateText: '每日12:00更新',
    cover: 'linear-gradient(155deg, #0b132b 0%, #3a506b 52%, #5bc0be 100%)',
    accent: '#32b7b6',
    desc: '被全公司看不起的实习生，在融资路演当天接管了董事长专线。',
    lines: ['你们说的甲方，是我爸。', '别急，合同还没轮到你签。'],
    episodes: makeEpisodes(40, ['被调去茶水间', '董事长专线', '融资会反杀']),
  },
  {
    id: 'contract-lover',
    title: '替身协议到期后',
    category: '甜宠',
    tags: ['替身', '追妻', '虐恋'],
    total: 34,
    freeEpisodes: 5,
    unlockSize: 4,
    status: '已完结',
    heat: '548.1万',
    follows: '7.4万',
    score: '8.7',
    updateText: '全集上线',
    cover: 'linear-gradient(155deg, #2b0f1a 0%, #9a275a 45%, #ffd1dc 100%)',
    accent: '#e7558b',
    desc: '协议到期那天她潇洒离开，他却发现自己输给了亲手写下的条款。',
    lines: ['合同结束了，傅先生。', '可我还没学会放你走。'],
    episodes: makeEpisodes(34, ['协议到期', '她没有回头', '迟到的告白']),
  },
];

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

export function getExternalDramas() {
  const list = readStorage(EXTERNAL_DRAMA_CACHE_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function cacheExternalDramas(list = []) {
  const validList = Array.isArray(list) ? list.filter((item) => item && item.id) : [];
  if (validList.length === 0) {
    return getExternalDramas();
  }

  const merged = [...validList, ...getExternalDramas()].reduce((map, item) => {
    map.set(String(item.id), item);
    return map;
  }, new Map());
  const next = Array.from(merged.values()).slice(0, 120);
  writeStorage(EXTERNAL_DRAMA_CACHE_KEY, next);
  return next;
}

export function getDramaById(id) {
  const targetId = String(id || '');
  const source = REQUIRE_REAL_CONTENT ? getExternalDramas() : [...getExternalDramas(), ...DRAMAS];
  return (
    source.find((item) => String(item.id) === targetId) || (REQUIRE_REAL_CONTENT ? null : DRAMAS[0])
  );
}

export function getHotDramas(limit = DRAMAS.length) {
  const source = REQUIRE_REAL_CONTENT ? getExternalDramas() : [...getExternalDramas(), ...DRAMAS];
  return source.slice(0, limit);
}

export function getDramasByCategory(category) {
  if (!category || category === '全部' || category === '热播') {
    return getHotDramas();
  }
  const source = REQUIRE_REAL_CONTENT ? getExternalDramas() : [...getExternalDramas(), ...DRAMAS];
  return source.filter((item) => item.category === category);
}

export function getRecommendDrama() {
  return getHotDramas(1)[0] || (REQUIRE_REAL_CONTENT ? null : DRAMAS[0]);
}

export function saveHistory(id, episode = 1) {
  const drama = getDramaById(id);
  if (!drama) {
    return;
  }
  const safeEpisode = Math.max(1, Math.min(Number(episode) || 1, drama.total));
  const history = readStorage(HISTORY_KEY, []).filter((item) => item.id !== id);
  history.unshift({
    id,
    episode: safeEpisode,
    total: drama.total,
    watchedAt: Date.now(),
  });
  writeStorage(HISTORY_KEY, history.slice(0, 30));
}

export function getHistoryList() {
  return readStorage(HISTORY_KEY, [])
    .map((item) => ({
      ...item,
      drama: getDramaById(item.id),
    }))
    .filter((item) => item.drama);
}

export function getFollowIds() {
  return readStorage(FOLLOW_KEY, []);
}

export function isFollowed(id) {
  return getFollowIds().includes(id);
}

export function toggleFollow(id) {
  const follows = getFollowIds();
  const exists = follows.includes(id);
  const next = exists ? follows.filter((item) => item !== id) : [id, ...follows];
  writeStorage(FOLLOW_KEY, next);
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

export function getUnlockedEpisodes(id) {
  const map = readStorage(UNLOCK_KEY, {});
  return map[id] || [];
}

export function isEpisodeUnlocked(drama, episode) {
  const safeEpisode = Number(episode) || 1;
  return safeEpisode <= drama.freeEpisodes || getUnlockedEpisodes(drama.id).includes(safeEpisode);
}

export function getUnlockRange(drama, startEpisode) {
  const unlocked = getUnlockedEpisodes(drama.id);
  const range = [];
  for (let episode = Number(startEpisode) || 1; episode <= drama.total; episode += 1) {
    if (episode <= drama.freeEpisodes || unlocked.includes(episode)) {
      continue;
    }
    range.push(episode);
    if (range.length >= drama.unlockSize) {
      break;
    }
  }
  return range;
}

export function unlockEpisodes(id, episodes) {
  const map = readStorage(UNLOCK_KEY, {});
  const current = new Set(map[id] || []);
  episodes.forEach((episode) => current.add(Number(episode)));
  map[id] = [...current].sort((a, b) => a - b);
  writeStorage(UNLOCK_KEY, map);
}
