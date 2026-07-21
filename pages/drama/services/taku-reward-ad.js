import {
  createNativeTelemetryValidator,
  getNativePlugin,
  nativeTelemetryToClientEvent,
  validateNativeServerProtocol,
} from './native-bridge';

const TAKU_PLUGIN_NAME = 'SkitTakuAd';

export class AdFlowError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AdFlowError';
    this.code = code;
    if (options.cause) {
      this.cause = options.cause;
    }
    if (options.terminalTelemetry) {
      this.terminalTelemetry = options.terminalTelemetry;
    }
  }
}

function flowError(code, message, cause, terminalTelemetry) {
  if (cause instanceof AdFlowError && cause.code === code) {
    if (terminalTelemetry && !cause.terminalTelemetry) {
      cause.terminalTelemetry = terminalTelemetry;
    }
    return cause;
  }
  return new AdFlowError(code, message, { cause, terminalTelemetry });
}

export function isTakuRewardAdReady() {
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  return !!plugin && typeof plugin.showRewardedVideo === 'function';
}

export function cancelPendingRewardedVideoAd() {
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  if (!plugin || typeof plugin.cancelRewardedVideo !== 'function') {
    return false;
  }
  try {
    const result = plugin.cancelRewardedVideo({}, () => {});
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
    }
    return true;
  } catch (error) {
    return false;
  }
}

export function showRewardedVideoAd(serverProtocol, options = {}) {
  const protocol = validateNativeServerProtocol(serverProtocol);
  const plugin = getNativePlugin(TAKU_PLUGIN_NAME);
  if (!plugin || typeof plugin.showRewardedVideo !== 'function') {
    return Promise.reject(flowError('NATIVE_AD_UNAVAILABLE', '激励视频暂不可用'));
  }
  const validator = createNativeTelemetryValidator(protocol);
  const onClientEvent = options.onClientEvent || (() => undefined);
  const timeoutMs = options.timeoutMs || 180000;
  const telemetryRetryDelaysMs = options.telemetryRetryDelaysMs || [150, 400];
  if (
    !Array.isArray(telemetryRetryDelaysMs) ||
    telemetryRetryDelaysMs.some(
      (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 5000,
    )
  ) {
    return Promise.reject(flowError('TELEMETRY_RETRY_INVALID', '广告状态同步重试参数无效'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let delivery = Promise.resolve();
    let deliveryError = null;
    const timer = setTimeout(() => {
      if (deliveryError) {
        finishWithError(
          flowError(
            'TELEMETRY_DELIVERY_FAILED',
            deliveryError.message || '广告状态同步失败',
            deliveryError,
          ),
        );
        return;
      }
      finishWithError(flowError('NATIVE_AD_TIMEOUT', '激励视频响应超时'));
    }, timeoutMs);

    function finishWithError(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(
        error instanceof Error
          ? error
          : flowError('NATIVE_AD_FAILED', String(error || '激励视频加载失败')),
      );
    }

    function enqueueClientEvent(clientEvent, telemetry) {
      delivery = delivery
        .then(async () => {
          let lastError;
          for (let attempt = 0; attempt <= telemetryRetryDelaysMs.length; attempt += 1) {
            try {
              await onClientEvent(clientEvent, telemetry);
              return;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              if (attempt < telemetryRetryDelaysMs.length) {
                await new Promise((resolveDelay) =>
                  setTimeout(resolveDelay, telemetryRetryDelaysMs[attempt]),
                );
              }
            }
          }
          throw lastError || new Error('广告状态同步失败');
        })
        .catch((error) => {
          deliveryError ||= error instanceof Error ? error : new Error(String(error));
        });
    }

    function finishTerminal(telemetry) {
      delivery.then(() => {
        if (settled) {
          return;
        }
        if (deliveryError) {
          finishWithError(
            flowError(
              'TELEMETRY_DELIVERY_FAILED',
              deliveryError.message || '广告状态同步失败',
              deliveryError,
              telemetry,
            ),
          );
          return;
        }
        if (telemetry.nativeState === 'ERROR') {
          finishWithError(flowError('NATIVE_AD_FAILED', '激励视频播放失败', undefined, telemetry));
          return;
        }
        settled = true;
        clearTimeout(timer);
        const rewardObserved = telemetry.clientRewardObserved === true;
        resolve(
          Object.freeze({
            outcome: rewardObserved ? 'REWARD_OBSERVED' : 'INCOMPLETE',
            rewardObserved,
            terminalTelemetry: telemetry,
          }),
        );
      });
    }

    function receive(rawValue) {
      if (settled) {
        return;
      }
      let telemetry;
      try {
        telemetry = validator.accept(rawValue);
      } catch (error) {
        finishWithError(
          flowError('NATIVE_PROTOCOL_INVALID', error?.message || '原生广告回调无效', error),
        );
        return;
      }
      const clientEvent = nativeTelemetryToClientEvent(telemetry);
      if (clientEvent) {
        enqueueClientEvent(clientEvent, telemetry);
      }
      if (telemetry.nativeState === 'ERROR' || telemetry.nativeState === 'CLOSED') {
        finishTerminal(telemetry);
      }
    }

    try {
      const result = plugin.showRewardedVideo(protocol, receive);
      if (result && typeof result.then === 'function') {
        result
          .then((value) => value !== undefined && receive(value))
          .catch((error) =>
            finishWithError(
              flowError('NATIVE_AD_FAILED', error?.message || '激励视频加载失败', error),
            ),
          );
      } else if (result !== undefined) {
        receive(result);
      }
    } catch (error) {
      finishWithError(flowError('NATIVE_AD_FAILED', error?.message || '激励视频加载失败', error));
    }
  });
}
