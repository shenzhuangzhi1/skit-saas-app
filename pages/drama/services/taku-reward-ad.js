import { callNativeMethod, getNativePlugin } from './native-bridge';

const TAKU_PLUGIN_NAME = 'SkitTakuAd';
const DEFAULT_REWARD_PLACEMENT_ID = import.meta.env?.VITE_TAKU_REWARD_PLACEMENT_ID || '';
const MOCK_REWARD_AD =
  import.meta.env?.VITE_DRAMA_MOCK_REWARD_AD === 'true' ||
  (import.meta.env?.MODE !== 'production' && import.meta.env?.VITE_DRAMA_MOCK_REWARD_AD !== 'false');

function normalizeRewardResult(result = {}) {
  const type = String(result.type || result.event || result.status || '').toLowerCase();
  const completed =
    result.completed === true ||
    result.rewarded === true ||
    result.isReward === true ||
    result.isRewarded === true ||
    type === 'reward' ||
    type === 'rewarded' ||
    type === 'completed' ||
    type === 'complete';

  return {
    completed,
    closed: result.closed === true || type === 'close' || type === 'closed',
    mock: result.mock === true,
    raw: result,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showMockRewardedVideo(context) {
  await wait(650);
  console.warn('[drama] Taku native plugin missing, using development mock rewarded ad.', context);
  return {
    completed: true,
    closed: true,
    mock: true,
    raw: { mock: true },
  };
}

export function isTakuRewardAdReady() {
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  return !!plugin && typeof plugin.showRewardedVideo === 'function';
}

export async function showRewardedVideoAd(context = {}) {
  const placementId = context.placementId || DEFAULT_REWARD_PLACEMENT_ID;
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);

  if (!plugin || typeof plugin.showRewardedVideo !== 'function') {
    if (MOCK_REWARD_AD) {
      return showMockRewardedVideo(context);
    }
    throw new Error('Taku 激励视频 SDK 未接入');
  }

  const result = await callNativeMethod(
    plugin,
    'showRewardedVideo',
    {
      placementId,
      scene: context.scene || 'drama_unlock',
      extra: {
        dramaId: context.dramaId,
        episode: context.episode,
        unlockRange: context.unlockRange,
      },
    },
    { timeoutMs: 180000 },
  );

  const reward = normalizeRewardResult(result);
  if (!reward.completed) {
    throw new Error('完整观看广告后才能解锁');
  }
  return reward;
}
