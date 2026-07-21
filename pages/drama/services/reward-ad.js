import {
  cancelPendingRewardedVideoAd as cancelPendingTakuRewardedVideoAd,
  showRewardedVideoAd as showTakuRewardedVideoAd,
} from './taku-reward-ad';

export function cancelPendingDramaRewardedVideoAd() {
  return cancelPendingTakuRewardedVideoAd();
}

export function showDramaRewardedVideoAd(options = {}) {
  return showTakuRewardedVideoAd(options.protocol, {
    onClientEvent: options.onClientEvent,
  });
}
