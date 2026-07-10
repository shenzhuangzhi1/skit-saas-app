import { showGroMoreRewardedVideoAd } from './gromore-reward-ad';
import { showRewardedVideoAd as showTakuRewardedVideoAd } from './taku-reward-ad';

const DEFAULT_PROVIDER = import.meta.env?.VITE_DRAMA_AD_PROVIDER || 'gromore';

export async function showDramaRewardedVideoAd(context = {}) {
  const provider = String(context.provider || DEFAULT_PROVIDER).toLowerCase();

  if (provider === 'taku') {
    return showTakuRewardedVideoAd(context);
  }

  if (provider === 'gromore' || provider === 'csj' || provider === 'pangle') {
    return showGroMoreRewardedVideoAd(context);
  }

  throw new Error(`未知广告聚合渠道: ${provider}`);
}
