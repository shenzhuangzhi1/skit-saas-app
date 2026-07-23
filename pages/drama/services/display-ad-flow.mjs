export const POST_CHECK_IN_MARKER_KEY = 'skit_post_checkin_interstitial';

export const DISPLAY_AD_SCENES = Object.freeze({
  CHECK_IN_ENTRY: 'checkin_entry_interstitial',
  POST_CHECK_IN_FIRST_PLAY: 'post_checkin_first_play_interstitial',
  HOME_BANNER: 'home_banner',
});

const PLACEMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 15000;
const INTERSTITIAL_TERMINAL_TIMEOUT_MS = 120000;

function defaultStorage() {
  if (typeof uni === 'undefined') {
    return null;
  }
  return uni;
}

function defaultNativePlugin() {
  if (typeof uni === 'undefined' || typeof uni.requireNativePlugin !== 'function') {
    return null;
  }
  return uni.requireNativePlugin('SkitTakuAd');
}

function normalizeIdentity(value = {}) {
  const tenantId = String(value.tenantId ?? '').trim();
  const memberId = String(value.memberId ?? value.userId ?? '').trim();
  const signInDate = String(value.signInDate ?? '').trim();
  if (!tenantId || !memberId || !/^\d{4}-\d{2}-\d{2}$/.test(signInDate)) {
    return null;
  }
  return { tenantId, memberId, signInDate };
}

function sameIdentity(left, right) {
  return (
    left?.tenantId === right?.tenantId &&
    left?.memberId === right?.memberId &&
    left?.signInDate === right?.signInDate
  );
}

function sameMemberScope(left, right) {
  return left?.tenantId === right?.tenantId && left?.memberId === right?.memberId;
}

function dateOrdinal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) {
    return Number.NaN;
  }
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return Number.NaN;
  }
  return Math.floor(timestamp / 86400000);
}

function isEligiblePostCheckInMarker(marker, activeIdentity) {
  if (!sameMemberScope(marker, activeIdentity)) {
    return false;
  }
  const ageDays = dateOrdinal(activeIdentity.signInDate) - dateOrdinal(marker.signInDate);
  return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= 1;
}

export function chinaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function resolveDisplayPlacements(config = {}) {
  const taku = config?.taku || {};
  return Object.freeze({
    checkInEntryInterstitial:
      taku.checkInEntryInterstitialPlacementId || config.checkInEntryInterstitialPlacementId || '',
    postCheckInDramaInterstitial:
      taku.postCheckInDramaInterstitialPlacementId ||
      config.postCheckInDramaInterstitialPlacementId ||
      '',
    homeBanner: taku.homeBannerPlacementId || config.homeBannerPlacementId || '',
  });
}

export function createPageVisitGuard() {
  let epoch = 0;
  let active = false;
  return Object.freeze({
    enter() {
      active = true;
      epoch += 1;
      return epoch;
    },
    leave() {
      active = false;
      epoch += 1;
      return epoch;
    },
    capture() {
      return epoch;
    },
    isCurrent(capturedEpoch) {
      return active && Number.isSafeInteger(capturedEpoch) && capturedEpoch === epoch;
    },
  });
}

export function createDisplayAdFlow(options = {}) {
  const storage = options.storage || defaultStorage();
  const getNativePlugin = options.getNativePlugin || defaultNativePlugin;
  const now = options.now || (() => new Date());
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const interstitialTimeoutMs = options.interstitialTimeoutMs || INTERSTITIAL_TERMINAL_TIMEOUT_MS;
  let playFlight = null;

  function readMarker() {
    if (!storage || typeof storage.getStorageSync !== 'function') {
      return null;
    }
    const raw = storage.getStorageSync(POST_CHECK_IN_MARKER_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return normalizeIdentity(parsed);
    } catch {
      return null;
    }
  }

  function clearPostCheckInMarker() {
    if (storage && typeof storage.removeStorageSync === 'function') {
      storage.removeStorageSync(POST_CHECK_IN_MARKER_KEY);
    }
  }

  function markPostCheckIn(identity) {
    const normalized = normalizeIdentity(identity);
    if (!normalized || !storage || typeof storage.setStorageSync !== 'function') {
      return false;
    }
    storage.setStorageSync(POST_CHECK_IN_MARKER_KEY, JSON.stringify(normalized));
    return true;
  }

  function hasPostCheckInMarker(identity) {
    const normalized = normalizeIdentity(identity);
    return normalized !== null && isEligiblePostCheckInMarker(readMarker(), normalized);
  }

  function callNative(method, placementId, scene, requestTimeoutMs = timeoutMs) {
    const normalizedPlacementId = String(placementId || '').trim();
    if (!PLACEMENT_ID_PATTERN.test(normalizedPlacementId)) {
      return Promise.resolve({ shown: false, reason: 'PLACEMENT_NOT_CONFIGURED' });
    }
    const plugin = getNativePlugin();
    if (!plugin || typeof plugin[method] !== 'function') {
      return Promise.resolve({ shown: false, reason: 'NATIVE_AD_UNAVAILABLE' });
    }
    return new Promise((resolve) => {
      let settled = false;
      let nativeRequestId = '';
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        if (
          method === 'showInterstitial' &&
          nativeRequestId &&
          typeof plugin.cancelInterstitial === 'function'
        ) {
          try {
            plugin.cancelInterstitial({ requestId: nativeRequestId }, () => {});
          } catch {
            // The navigation path remains fail-open even if native cancellation fails.
          }
        } else if (
          nativeRequestId &&
          typeof plugin.forgetRequestCallback === 'function'
        ) {
          try {
            plugin.forgetRequestCallback({ requestId: nativeRequestId });
          } catch {
            // Callback cleanup is best effort; the user flow must still continue.
          }
        }
        resolve({ shown: false, reason: 'NATIVE_AD_TIMEOUT' });
      }, requestTimeoutMs);
      const finish = (raw = {}) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          shown: raw.success === true,
          reason: raw.failureReason || raw.reason || raw.message || '',
          raw,
        });
      };
      try {
        const returned = plugin[method]({ placementId: normalizedPlacementId, scene }, finish);
        if (returned && typeof returned.then === 'function') {
          returned
            .then(finish)
            .catch((error) =>
              finish({ success: false, reason: error?.message || 'NATIVE_AD_FAILED' }),
            );
        } else if (typeof returned === 'string') {
          nativeRequestId = returned;
        } else if (returned !== undefined) {
          finish(returned);
        }
      } catch (error) {
        finish({ success: false, reason: error?.message || 'NATIVE_AD_FAILED' });
      }
    });
  }

  function showCheckInEntryInterstitial(placementId) {
    return callNative(
      'showInterstitial',
      placementId,
      DISPLAY_AD_SCENES.CHECK_IN_ENTRY,
      interstitialTimeoutMs,
    );
  }

  function showHomeBanner(placementId) {
    return callNative('showBanner', placementId, DISPLAY_AD_SCENES.HOME_BANNER);
  }

  async function hideHomeBanner() {
    const plugin = getNativePlugin();
    if (!plugin || typeof plugin.hideBanner !== 'function') {
      return { hidden: false, reason: 'NATIVE_AD_UNAVAILABLE' };
    }
    return new Promise((resolve) => {
      let settled = false;
      let nativeRequestId = '';
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        if (nativeRequestId && typeof plugin.forgetRequestCallback === 'function') {
          try {
            plugin.forgetRequestCallback({ requestId: nativeRequestId });
          } catch {
            // Callback cleanup is best effort; the user flow must still continue.
          }
        }
        resolve({ hidden: false, reason: 'NATIVE_AD_TIMEOUT' });
      }, timeoutMs);
      const finish = (raw = {}) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          hidden: raw.success === true,
          reason: raw.failureReason || raw.reason || raw.message || '',
          raw,
        });
      };
      try {
        const returned = plugin.hideBanner({ scene: DISPLAY_AD_SCENES.HOME_BANNER }, finish);
        if (returned && typeof returned.then === 'function') {
          returned.then(finish).catch(() => finish({ success: false }));
        } else if (typeof returned === 'string') {
          nativeRequestId = returned;
        } else if (returned !== undefined) {
          finish(returned);
        }
      } catch {
        finish({ success: false });
      }
    });
  }

  function runBeforeDramaPlay({
    tenantId,
    memberId,
    userId,
    signInDate = chinaDate(now()),
    placementId,
    resolvePlacement,
    beforePlay,
    canOpenPlayer,
    openPlayer,
  }) {
    if (playFlight) {
      return playFlight;
    }
    if (typeof openPlayer !== 'function') {
      return Promise.reject(new TypeError('openPlayer must be a function'));
    }
    const canContinue = () => {
      if (typeof canOpenPlayer !== 'function') {
        return true;
      }
      try {
        return canOpenPlayer() === true;
      } catch {
        return false;
      }
    };
    playFlight = (async () => {
      if (typeof beforePlay === 'function') {
        try {
          await beforePlay();
        } catch {
          // Pre-navigation cleanup is fail-open; the page guard still decides navigation.
        }
      }
      if (!canContinue()) {
        return false;
      }
      const activeIdentity = normalizeIdentity({
        tenantId,
        memberId: memberId ?? userId,
        signInDate,
      });
      const marker = readMarker();
      const matchedPostCheckInMarker =
        activeIdentity !== null && isEligiblePostCheckInMarker(marker, activeIdentity);
      if (
        activeIdentity &&
        marker &&
        sameMemberScope(marker, activeIdentity) &&
        !matchedPostCheckInMarker
      ) {
        clearPostCheckInMarker();
      }
      if (matchedPostCheckInMarker) {
        let resolvedPlacementId = placementId;
        if (typeof resolvePlacement === 'function') {
          try {
            resolvedPlacementId = await resolvePlacement();
          } catch {
            resolvedPlacementId = '';
          }
        }
        if (!canContinue()) {
          return false;
        }
        await callNative(
          'showInterstitial',
          resolvedPlacementId,
          DISPLAY_AD_SCENES.POST_CHECK_IN_FIRST_PLAY,
          interstitialTimeoutMs,
        );
      }
      if (!canContinue()) {
        return false;
      }
      if (matchedPostCheckInMarker && sameIdentity(readMarker(), marker)) {
        clearPostCheckInMarker();
      }
      return openPlayer();
    })().finally(() => {
      playFlight = null;
    });
    return playFlight;
  }

  return Object.freeze({
    markPostCheckIn,
    hasPostCheckInMarker,
    clearPostCheckInMarker,
    showCheckInEntryInterstitial,
    showHomeBanner,
    hideHomeBanner,
    runBeforeDramaPlay,
  });
}

export const displayAdFlow = createDisplayAdFlow();
