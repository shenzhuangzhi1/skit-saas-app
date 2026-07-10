import { callNativeMethod, getNativePlugin } from './native-bridge';

const GROMORE_PLUGIN_NAME = 'SkitGroMoreAd';
const DEFAULT_REWARD_CODE_ID = import.meta.env?.VITE_GROMORE_REWARD_CODE_ID || '';
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
    result.isRewardValid === true ||
    type === 'reward' ||
    type === 'rewarded' ||
    type === 'completed' ||
    type === 'complete';

  return {
    completed,
    closed: result.closed === true || type === 'close' || type === 'closed',
    provider: 'gromore',
    mock: result.mock === true,
    raw: result,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showMockRewardedVideo(context) {
  await wait(650);
  console.warn('[drama] GroMore native plugin missing, using development mock rewarded ad.', context);
  return {
    completed: true,
    closed: true,
    provider: 'gromore',
    mock: true,
    raw: { mock: true },
  };
}

export function isGroMoreRewardAdReady() {
  const plugin = getNativePlugin(GROMORE_PLUGIN_NAME);
  return !!plugin && typeof plugin.showRewardedVideo === 'function';
}

export async function showGroMoreRewardedVideoAd(context = {}) {
  const codeId = context.codeId || context.placementId || DEFAULT_REWARD_CODE_ID;
  const plugin = getNativePlugin(GROMORE_PLUGIN_NAME);

  if (!plugin || typeof plugin.showRewardedVideo !== 'function') {
    if (MOCK_REWARD_AD) {
      return showMockRewardedVideo(context);
    }
    throw new Error('GroMore 激励视频 SDK 未接入');
  }

  const result = await callNativeMethod(
    plugin,
    'showRewardedVideo',
    {
      codeId,
      scene: context.scene || 'drama_unlock',
      rewardName: context.rewardName || '短剧解锁',
      rewardAmount: context.rewardAmount || 1,
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
