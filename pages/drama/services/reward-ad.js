import { showRewardedVideoAd as showTakuRewardedVideoAd } from './taku-reward-ad';

export function showDramaRewardedVideoAd(options = {}) {
  return showTakuRewardedVideoAd(options.protocol, {
    onClientEvent: options.onClientEvent,
  });
}
