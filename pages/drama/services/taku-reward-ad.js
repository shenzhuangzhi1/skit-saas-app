import {
  createNativeTelemetryValidator,
  getNativePlugin,
  nativeTelemetryToClientEvent,
  validateNativeServerProtocol,
} from './native-bridge';

const TAKU_PLUGIN_NAME = 'SkitTakuAd';

export function isTakuRewardAdReady() {
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  return !!plugin && typeof plugin.showRewardedVideo === 'function';
}

export function showRewardedVideoAd(serverProtocol, options = {}) {
  const protocol = validateNativeServerProtocol(serverProtocol);
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  if (!plugin || typeof plugin.showRewardedVideo !== 'function') {
    return Promise.reject(new Error('激励视频暂不可用'));
  }
  const validator = createNativeTelemetryValidator(protocol);
  const onClientEvent = options.onClientEvent || (() => undefined);
  const timeoutMs = options.timeoutMs || 180000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let delivery = Promise.resolve();
    const timer = setTimeout(() => finishWithError(new Error('激励视频响应超时')), timeoutMs);

    function finishWithError(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error || '激励视频加载失败')));
    }

    function receive(rawValue) {
      if (settled) {
        return;
      }
      let telemetry;
      try {
        telemetry = validator.accept(rawValue);
      } catch (error) {
        finishWithError(error);
        return;
      }
      const clientEvent = nativeTelemetryToClientEvent(telemetry);
      if (clientEvent) {
        delivery = delivery.then(() => onClientEvent(clientEvent, telemetry));
        delivery.catch(finishWithError);
      }
      if (telemetry.nativeState === 'ERROR') {
        delivery.then(() => finishWithError(new Error('激励视频播放失败')), finishWithError);
      } else if (telemetry.nativeState === 'CLOSED') {
        delivery.then(() => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(Object.freeze({ terminalTelemetry: telemetry }));
        }, finishWithError);
      }
    }

    try {
      const result = plugin.showRewardedVideo(protocol, receive);
      if (result && typeof result.then === 'function') {
        result.then((value) => value !== undefined && receive(value)).catch(finishWithError);
      } else if (result !== undefined) {
        receive(result);
      }
    } catch (error) {
      finishWithError(error);
    }
  });
}
