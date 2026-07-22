<template>
  <view class="play-page" :style="{ background: drama.cover }">
    <view class="page-mask"></view>

    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="24" color="#fff" />
      </view>
      <view class="header-title ss-line-1">{{ drama.title }}</view>
    </view>

    <view class="video-stage">
      <view class="fake-video">
        <video
          v-if="currentVideoUrl && !videoErrored"
          :key="`${drama.id}-${currentEpisode}`"
          class="episode-video"
          :src="currentVideoUrl"
          :controls="false"
          :autoplay="true"
          :muted="true"
          :loop="false"
          object-fit="cover"
          x5-video-player-type="h5"
          x5-video-orientation="portrait"
          playsinline
          webkit-playsinline
          @play="handleVideoPlay"
          @error="handleVideoError"
        />
        <view v-if="!currentVideoUrl" class="content-placeholder">
          <uni-icons type="videocam" size="44" color="#fff" />
          <view class="placeholder-title">
            {{ pangleReady ? '播放器已就绪' : '当前剧集暂不可播放' }}
          </view>
          <view class="placeholder-desc">
            {{ pangleReady ? '正在打开剧集' : '请稍后再试' }}
          </view>
        </view>
        <view class="episode-badge">第{{ currentEpisode }}集</view>
        <view class="video-copy">
          <view class="video-title">{{ currentEpisodeTitle }}</view>
          <view class="video-line">{{ currentLine }}</view>
        </view>
        <view v-if="locked" class="locked-layer">
          <uni-icons type="locked-filled" size="42" color="#fff" />
          <view class="locked-title">本集需要解锁</view>
          <view class="locked-desc"> 看广告后可解锁第{{ unlockRangeText }}集 </view>
          <button
            class="unlock-btn"
            :disabled="unlocking"
            :loading="unlocking"
            @tap.stop="unlockCurrent"
          >
            {{ unlocking ? '广告加载中' : '看广告解锁' }}
          </button>
        </view>
      </view>

      <view class="side-actions">
        <view class="action" @tap="toggleDramaFollow">
          <uni-icons :type="followed ? 'heart-filled' : 'heart'" size="27" color="#fff" />
          <text>{{ followed ? '已追' : '追剧' }}</text>
        </view>
        <view class="action" @tap="shareDrama">
          <uni-icons type="paperplane" size="27" color="#fff" />
          <text>分享</text>
        </view>
        <view class="action" @tap="showEpisodePanel = true">
          <uni-icons type="list" size="27" color="#fff" />
          <text>选集</text>
        </view>
      </view>
    </view>

    <view class="bottom-info">
      <view class="drama-title">{{ drama.title }}</view>
      <view class="drama-desc">{{ drama.desc }}</view>
      <view class="meta-row">
        <text>{{ drama.status }}</text>
        <text>{{ drama.total }}集</text>
        <text>{{ drama.heat }}热度</text>
      </view>
      <view class="bottom-actions">
        <button
          v-if="canOpenPanglePlayer"
          class="ghost-btn"
          @tap="playCurrentEpisode('manual_open')"
        >
          开始播放
        </button>
        <button class="primary-btn" @tap="nextEpisode">下一集</button>
        <button class="ghost-btn" @tap="showEpisodePanel = true">选集</button>
      </view>
    </view>

    <view v-if="showEpisodePanel" class="episode-mask" @tap="showEpisodePanel = false"></view>
    <view v-if="showEpisodePanel" class="episode-panel">
      <view class="episode-head">
        <view>
          <view class="episode-title">{{ drama.title }}</view>
          <view class="episode-status">{{ drama.status }} · 共{{ drama.total }}集</view>
        </view>
        <button class="follow-btn" @tap="toggleDramaFollow">
          {{ followed ? '取消追剧' : '加入追剧' }}
        </button>
      </view>
      <scroll-view scroll-y class="episode-scroll">
        <view class="episode-grid">
          <view
            v-for="episode in drama.episodes"
            :key="episode.episode"
            class="episode-item"
            :class="{
              active: episode.episode === currentEpisode,
              locked: !isUnlocked(episode.episode),
            }"
            @tap="chooseEpisode(episode.episode)"
          >
            <text>{{ episode.episode }}</text>
            <uni-icons
              v-if="!isUnlocked(episode.episode)"
              class="lock-icon"
              type="locked-filled"
              size="12"
              color="#999"
            />
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
  import { computed, ref, watch } from 'vue';
  import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
  import sheep from '@/sheep';
  import {
    getDramaById,
    isEpisodeUnlocked,
    isFollowed,
    saveHistory,
    toggleFollow,
  } from '@/pages/drama/data';
  import {
    hasPangleDramaId,
    isPangleContentReady,
    openPangleDramaPlayer,
  } from '@/pages/drama/services/pangle-content';
  import {
    acquireAdSessionOwnership,
    adSessionOrchestrator,
    recoverPendingAdSessions,
  } from '@/pages/drama/services/ad-session-runtime';
  import { createDramaPageAsyncGuard } from '@/pages/drama/services/drama-page-async-guard';
  import {
    cancelPendingDramaRewardedVideoAd,
    showDramaRewardedVideoAd,
  } from '@/pages/drama/services/reward-ad';
  import { ensureAdPrivacyConsent } from '@/pages/drama/services/privacy-consent';

  const drama = ref(getDramaById());
  const currentEpisode = ref(1);
  const followed = ref(false);
  const grantedEpisodeNos = ref([]);
  const authoritativeIdentity = ref('');
  const activePlaybackEpisode = ref(null);
  const showEpisodePanel = ref(false);
  const unlocking = ref(false);
  const videoErrored = ref(false);
  const pangleReady = ref(false);
  const pendingVerificationSessions = new Set();
  const userStore = sheep.$store('user');
  const pageAsyncGuard = createDramaPageAsyncGuard();
  const STALE_PAGE_CONTEXT = 'STALE_PAGE_CONTEXT';
  let pageHasShown = false;
  let foregroundSyncPending = false;
  let pendingRawPlaybackEpisode = null;
  let pageInstance = null;

  const locked = computed(() => {
    return !isEpisodeUnlocked(drama.value, currentEpisode.value, grantedEpisodeNos.value);
  });

  const currentEpisodeTitle = computed(() => {
    return drama.value.episodes[currentEpisode.value - 1]?.title || `第${currentEpisode.value}集`;
  });

  const currentLine = computed(() => {
    const lines = drama.value.lines || [];
    return lines[(currentEpisode.value - 1) % lines.length] || drama.value.desc;
  });

  const rawCurrentVideoUrl = computed(() => {
    return drama.value.episodes[currentEpisode.value - 1]?.videoUrl || drama.value.videoUrl || '';
  });

  const currentVideoUrl = computed(() => {
    return activePlaybackEpisode.value === currentEpisode.value ? rawCurrentVideoUrl.value : '';
  });

  const canOpenPanglePlayer = computed(() => {
    return (
      pangleReady.value &&
      hasPangleDramaId(drama.value) &&
      !rawCurrentVideoUrl.value &&
      !locked.value
    );
  });

  const unlockRangeText = computed(() => {
    return currentEpisode.value;
  });

  function refresh() {
    followed.value = isFollowed(drama.value.id);
    pangleReady.value = isPangleContentReady() && hasPangleDramaId(drama.value);
  }

  function resolveServerDramaId() {
    const value =
      drama.value?.pangleDramaId ??
      drama.value?.contentId ??
      drama.value?.nativeId ??
      drama.value?.id;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error('当前剧目没有可验证的服务端短剧编号');
    }
    return number;
  }

  function currentIdentity() {
    const profile = userStore.userInfo || {};
    const tenantId = profile.tenantId;
    const memberId = profile.userId ?? profile.id;
    if (
      tenantId === undefined ||
      tenantId === null ||
      memberId === undefined ||
      memberId === null
    ) {
      throw new Error('当前登录身份尚未同步完成');
    }
    return { tenantId, memberId };
  }

  function authorizationScope(identity = currentIdentity(), dramaId = resolveServerDramaId()) {
    return {
      tenantId: String(identity.tenantId).trim(),
      memberId: String(identity.memberId).trim(),
      dramaId: Number(dramaId),
    };
  }

  function authorizationSignature(scope) {
    return JSON.stringify([scope.tenantId, scope.memberId, scope.dramaId]);
  }

  function sameAuthorizationScope(left, right) {
    return (
      !!left &&
      !!right &&
      left.tenantId === right.tenantId &&
      left.memberId === right.memberId &&
      left.dramaId === right.dramaId
    );
  }

  function currentAuthorizationScope() {
    if (!userStore.isLogin) {
      return null;
    }
    try {
      return authorizationScope();
    } catch (error) {
      return null;
    }
  }

  function stalePageContextError(cause) {
    const error = new Error('页面授权上下文已经失效');
    error.code = STALE_PAGE_CONTEXT;
    error.cause = cause;
    return error;
  }

  function isStalePageContextError(error) {
    return error?.code === STALE_PAGE_CONTEXT;
  }

  function beginPageRequest(
    channel,
    identity = currentIdentity(),
    dramaId = resolveServerDramaId(),
  ) {
    const expectedScope = authorizationScope(identity, dramaId);
    if (!sameAuthorizationScope(expectedScope, currentAuthorizationScope())) {
      throw stalePageContextError();
    }
    try {
      return pageAsyncGuard.begin(channel, expectedScope);
    } catch (error) {
      throw stalePageContextError(error);
    }
  }

  function isPageRequestCurrent(request) {
    const scope = currentAuthorizationScope();
    return !!scope && pageAsyncGuard.isCurrent(request, scope);
  }

  function isPageUiRequestCurrent(request) {
    const scope = currentAuthorizationScope();
    return !!scope && pageAsyncGuard.isUiCurrent(request, scope);
  }

  function isPageVisibleRequestCurrent(request) {
    return pageAsyncGuard.isVisible() && isPageRequestCurrent(request);
  }

  function assertPageRequestCurrent(request) {
    if (!isPageRequestCurrent(request)) {
      throw stalePageContextError();
    }
  }

  function assertPageVisibleRequestCurrent(request) {
    if (!isPageVisibleRequestCurrent(request)) {
      throw stalePageContextError();
    }
  }

  async function waitForPageUiRequestCurrent(request) {
    const scope = currentAuthorizationScope();
    if (!scope) {
      throw stalePageContextError();
    }
    try {
      await pageAsyncGuard.waitForUi(request, scope);
    } catch (error) {
      throw stalePageContextError(error);
    }
    assertPageVisibleRequestCurrent(request);
  }

  async function runNativeActivityPresentation(operation) {
    let finishPresentation;
    try {
      finishPresentation = pageAsyncGuard.beginPresentation();
      return await operation();
    } finally {
      finishPresentation?.();
      if (foregroundSyncPending && pageAsyncGuard.isVisible() && !pageAsyncGuard.isPresenting()) {
        foregroundSyncPending = false;
        syncServerState().catch((error) => {
          if (!isStalePageContextError(error)) {
            console.warn('[entitlement] foreground refresh unavailable', error?.message || error);
          }
        });
      }
    }
  }

  function isPageInstanceOnTop() {
    try {
      const pages = getCurrentPages();
      return !pageInstance || pages[pages.length - 1] === pageInstance;
    } catch (error) {
      return true;
    }
  }

  async function refreshAuthoritativeEntitlements(identity = currentIdentity()) {
    const dramaId = resolveServerDramaId();
    const scope = authorizationScope(identity, dramaId);
    const entitlementRequest = beginPageRequest('entitlements', identity, dramaId);
    const signature = authorizationSignature(scope);
    if (authoritativeIdentity.value !== signature) {
      authoritativeIdentity.value = signature;
      grantedEpisodeNos.value = [];
      activePlaybackEpisode.value = null;
    }
    grantedEpisodeNos.value = [];
    const snapshot = await adSessionOrchestrator.refreshEntitlements(identity, dramaId);
    assertPageRequestCurrent(entitlementRequest);
    grantedEpisodeNos.value = snapshot.grantedEpisodeNos;
    return snapshot;
  }

  async function recoverPendingSessions(identity) {
    const dramaId = resolveServerDramaId();
    const recoveryRequest = beginPageRequest('foreground-recovery', identity, dramaId);
    let currentDramaGranted = false;
    const results = await recoverPendingAdSessions(identity, {
      onResult(result, session) {
        if (result.resolution === 'GRANTED' && Number(session.dramaId) === dramaId) {
          currentDramaGranted = true;
        }
      },
    });
    assertPageRequestCurrent(recoveryRequest);
    if (!currentDramaGranted) {
      return results;
    }
    await refreshAuthoritativeEntitlements(identity);
    assertPageRequestCurrent(recoveryRequest);
    if (isPageUiRequestCurrent(recoveryRequest)) {
      uni.showToast({ title: '广告奖励已通过服务端验证', icon: 'none' });
    }
    return results;
  }

  function schedulePendingRewardVerification(
    identity,
    dramaId,
    episodeNo,
    sessionId,
    releaseOwnership,
  ) {
    if (pendingVerificationSessions.has(sessionId)) {
      return false;
    }
    if (typeof releaseOwnership !== 'function') {
      throw new Error('待验奖会话缺少 owner');
    }
    const pendingRequest = beginPageRequest(`pending:${sessionId}`, identity, dramaId);
    pendingVerificationSessions.add(sessionId);
    adSessionOrchestrator
      .watchPendingSession(identity, sessionId)
      .then(async (result) => {
        if (result.resolution === 'GRANTED') {
          if (!isPageRequestCurrent(pendingRequest)) {
            return;
          }
          if (!result.entitlements.grantedEpisodeNos.includes(episodeNo)) {
            throw new Error('目标剧集尚未获得服务端权益');
          }
          if (!isPageUiRequestCurrent(pendingRequest)) {
            return;
          }
          pageAsyncGuard.invalidateChannel('entitlements');
          grantedEpisodeNos.value = result.entitlements.grantedEpisodeNos;
          uni.showToast({ title: `已解锁第${episodeNo}集`, icon: 'none' });
          if (currentEpisode.value !== episodeNo) {
            return;
          }
          await playCurrentEpisode(
            'server_verified_reward',
            {
              dramaId,
              episodeNo,
              sessionId: result.status.sessionId,
              providerShowId: result.status.providerShowId,
            },
            episodeNo,
          );
          assertPageRequestCurrent(pendingRequest);
        }
      })
      .catch((error) => {
        if (isStalePageContextError(error) || !isPageRequestCurrent(pendingRequest)) {
          return;
        }
        console.warn(
          '[ad-session] pending reward verification unavailable',
          error?.message || error,
        );
      })
      .finally(() => {
        pendingVerificationSessions.delete(sessionId);
        releaseOwnership();
      });
    return true;
  }

  async function syncServerState() {
    refresh();
    if (!userStore.isLogin) {
      pageAsyncGuard.invalidateRequests();
      authoritativeIdentity.value = '';
      grantedEpisodeNos.value = [];
      pendingRawPlaybackEpisode = null;
      activePlaybackEpisode.value = null;
      return { skipped: true, reason: 'signed-out' };
    }
    let syncRequest;
    try {
      const identity = currentIdentity();
      const dramaId = resolveServerDramaId();
      syncRequest = beginPageRequest('sync', identity, dramaId);
      await refreshAuthoritativeEntitlements(identity);
      assertPageRequestCurrent(syncRequest);
      recoverPendingSessions(identity).catch((error) => {
        if (isStalePageContextError(error)) {
          return;
        }
        console.warn('[ad-session] pending recovery unavailable', error?.message || error);
      });
      return { synchronized: true, request: syncRequest };
    } catch (error) {
      if (isStalePageContextError(error)) {
        return { skipped: true, reason: 'stale-page-context' };
      }
      if (syncRequest && !isPageRequestCurrent(syncRequest)) {
        return { skipped: true, reason: 'stale-page-context' };
      }
      grantedEpisodeNos.value = [];
      activePlaybackEpisode.value = null;
      console.warn('[entitlement] server refresh unavailable', error?.message || error);
      return { skipped: true, reason: 'server-refresh-unavailable' };
    }
  }

  async function playAfterServerSync(source) {
    const syncResult = await syncServerState();
    if (!syncResult?.request || !isPageRequestCurrent(syncResult.request)) {
      return syncResult;
    }
    const playback = await playCurrentEpisode(source);
    assertPageRequestCurrent(syncResult.request);
    return playback;
  }

  async function syncAndResumePendingRawPlayback() {
    const syncResult = await syncServerState();
    if (
      !pageAsyncGuard.isVisible() ||
      pendingRawPlaybackEpisode === null ||
      pendingRawPlaybackEpisode !== currentEpisode.value ||
      !rawCurrentVideoUrl.value ||
      locked.value
    ) {
      return syncResult;
    }
    return await playCurrentEpisode('foreground_resume');
  }

  function goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      uni.navigateBack();
    } else {
      uni.switchTab({
        url: '/pages/index/index',
      });
    }
  }

  function isUnlocked(episode) {
    return isEpisodeUnlocked(drama.value, episode, grantedEpisodeNos.value);
  }

  function handleVideoPlay() {
    saveHistory(drama.value.id, currentEpisode.value);
  }

  function handleVideoError(error) {
    videoErrored.value = true;
    console.warn('[drama] video playback failed');
  }

  function playerErrorTitle(error) {
    const message = String(error?.message || '').trim();
    if (message.includes('CLIENT_RUNTIME_HEADERS_INVALID')) {
      return '请更新到最新版本后重试';
    }
    if (message.includes('ROLLOUT_OFF')) {
      return '当前剧集暂不可播放';
    }
    if (message.includes('MEMBER_NOT_IN_SHADOW')) {
      return '当前账号暂未开放体验';
    }
    if (message.includes('CLIENT_VERSION_REVOKED')) {
      return '请更新到最新版本后重试';
    }
    if (message.includes('AD_PLAYER_GRANT_INVALID')) {
      return '当前剧目尚未配置真实播放器';
    }
    return '暂时无法播放，请稍后重试';
  }

  function rewardErrorTitle(error) {
    const message = String(error?.message || '').trim();
    if (
      message.includes('CLIENT_RUNTIME_HEADERS_INVALID') ||
      message.includes('CLIENT_VERSION_REVOKED')
    ) {
      return '请更新到最新版本后重试';
    }
    if (
      Number(error?.code) === 1030007007 ||
      Number(error?.code) === 1030007008 ||
      Number(error?.code) === 1030007009
    ) {
      return '当前剧目正在准备，请稍后重试';
    }
    if (Number(error?.code) === 1030007010) {
      return '当前代理商内容授权未配置，请联系代理商';
    }
    if (Number(error?.code) === 1030007011) {
      return '当前剧目不在本代理商内容库，请选择其他剧目';
    }
    if (Number(error?.code) === 1030007012) {
      return '当前代理商内容授权失效，请联系代理商';
    }
    if (error?.code === 'TELEMETRY_DELIVERY_FAILED') {
      return '广告状态同步失败，请稍后重试';
    }
    if (error?.code === 'NATIVE_AD_NO_FILL') {
      return '当前广告库存不足，请稍后再试';
    }
    if (error?.code === 'PRIVACY_CONSENT_REQUIRED') {
      return '请先同意隐私与广告服务后再观看广告';
    }
    if (error?.code === 'PANGLE_INIT_FAILED') {
      return '内容与广告服务初始化失败，请重启应用后重试';
    }
    if (error?.code === 'TAKU_INIT_FAILED') {
      return '广告服务初始化失败，请稍后重试';
    }
    if (error?.code === 'REWARD_REJECTED' || error?.code === 'REWARD_VERIFY_TIMEOUT') {
      return '本次奖励未到账，请重新观看广告';
    }
    return '广告暂不可用，请稍后重试';
  }

  async function playCurrentEpisode(
    source,
    rewardEvidence = null,
    targetEpisode = currentEpisode.value,
  ) {
    let playerRequest;
    try {
      if (!Number.isSafeInteger(targetEpisode) || targetEpisode <= 0) {
        throw new Error('目标剧集无效');
      }
      if (!userStore.isLogin) {
        if (source !== 'page_load') {
          uni.navigateTo({
            url: '/pages/auth/index?mode=login',
          });
        }
        return;
      }
      const identity = currentIdentity();
      const dramaId = resolveServerDramaId();
      playerRequest = beginPageRequest('player', identity, dramaId);
      function assertPlayerLaunchCurrent() {
        assertPageVisibleRequestCurrent(playerRequest);
        if (currentEpisode.value !== targetEpisode) {
          throw stalePageContextError();
        }
      }
      if (targetEpisode > drama.value.freeEpisodes) {
        const snapshot = await refreshAuthoritativeEntitlements(identity);
        assertPageRequestCurrent(playerRequest);
        if (currentEpisode.value !== targetEpisode) {
          return { skipped: true, reason: 'episode-changed' };
        }
        if (!snapshot.grantedEpisodeNos.includes(targetEpisode)) {
          activePlaybackEpisode.value = null;
          if (source === 'manual_open' || source === 'episode_select') {
            uni.showToast({
              title: `第${targetEpisode}集需要解锁`,
              icon: 'none',
            });
          }
          return { skipped: true, reason: 'not-entitled' };
        }
      }
      if (rawCurrentVideoUrl.value) {
        pendingRawPlaybackEpisode = targetEpisode;
      }
      const playerGrant = await adSessionOrchestrator.issuePlayerGrant(identity, dramaId);
      assertPageRequestCurrent(playerRequest);
      if (currentEpisode.value !== targetEpisode) {
        return { skipped: true, reason: 'episode-changed' };
      }
      if (rawCurrentVideoUrl.value) {
        assertPlayerLaunchCurrent();
        pendingRawPlaybackEpisode = null;
        activePlaybackEpisode.value = targetEpisode;
        return;
      }
      if (!hasPangleDramaId(drama.value)) {
        return;
      }

      assertPageRequestCurrent(playerRequest);
      const consentGranted = await ensureAdPrivacyConsent(identity);
      assertPlayerLaunchCurrent();
      if (!consentGranted) {
        return { skipped: true, reason: 'privacy-consent-declined' };
      }
      const opened = await runNativeActivityPresentation(() =>
        openPangleDramaPlayer({
          drama: drama.value,
          episode: targetEpisode,
          source,
          playerGrant,
          rewardEvidence,
          assertCurrent: assertPlayerLaunchCurrent,
        }),
      );
      assertPageRequestCurrent(playerRequest);
      if (opened?.opened) {
        saveHistory(drama.value.id, targetEpisode);
      }
      return opened;
    } catch (error) {
      if (
        isStalePageContextError(error) ||
        (playerRequest && !isPageVisibleRequestCurrent(playerRequest))
      ) {
        return { skipped: true, reason: 'stale-page-context' };
      }
      if (pendingRawPlaybackEpisode === targetEpisode) {
        pendingRawPlaybackEpisode = null;
      }
      console.warn('[drama] protected player open failed:', error?.message || error);
      if (source === 'manual_open' || source === 'episode_select') {
        uni.showToast({
          title: playerErrorTitle(error),
          icon: 'none',
        });
        return { skipped: true, reason: error?.message || 'protected-player-open-failed' };
      }
      throw error;
    }
  }

  function chooseEpisode(episode) {
    currentEpisode.value = episode;
    showEpisodePanel.value = false;
    if (!isUnlocked(episode)) {
      uni.showToast({
        title: `第${episode}集需要解锁`,
        icon: 'none',
      });
      return;
    }
    playCurrentEpisode('episode_select').catch(() => {});
  }

  async function unlockCurrent() {
    if (unlocking.value) {
      return;
    }
    if (!userStore.isLogin) {
      uni.navigateTo({
        url: '/pages/auth/index?mode=login',
      });
      return;
    }
    const unlockEpisode = currentEpisode.value;
    unlocking.value = true;
    let releaseUnlockOwnership;
    let unlockRequest;
    try {
      const identity = currentIdentity();
      const dramaId = resolveServerDramaId();
      unlockRequest = beginPageRequest('unlock', identity, dramaId);
      const consentGranted = await ensureAdPrivacyConsent(identity);
      assertPageRequestCurrent(unlockRequest);
      if (!consentGranted) {
        uni.showToast({ title: '未同意隐私与广告服务，本集仍保持锁定', icon: 'none' });
        return;
      }
      releaseUnlockOwnership = await acquireAdSessionOwnership({
        ...identity,
        dramaId,
        episodeNo: unlockEpisode,
      });
      assertPageRequestCurrent(unlockRequest);
      if (!releaseUnlockOwnership) {
        uni.showToast({ title: '本集广告奖励确认中，请稍后查看', icon: 'none' });
        return;
      }
      if (isUnlocked(unlockEpisode)) {
        const snapshot = await refreshAuthoritativeEntitlements(identity);
        assertPageRequestCurrent(unlockRequest);
        if (snapshot.grantedEpisodeNos.includes(unlockEpisode)) {
          if (currentEpisode.value !== unlockEpisode) {
            return;
          }
          await playCurrentEpisode('server_entitled', null, unlockEpisode);
          assertPageRequestCurrent(unlockRequest);
          return;
        }
      }
      let result;
      const prepared = await adSessionOrchestrator.prepareUnlockSession(identity, {
        dramaId,
        episodeNo: unlockEpisode,
      });
      assertPageRequestCurrent(unlockRequest);
      if (prepared.kind === 'RECOVERED') {
        result = prepared.result;
      } else {
        const created = prepared.created;
        if (created.outcome === 'ALREADY_ENTITLED') {
          const snapshot = await refreshAuthoritativeEntitlements(identity);
          assertPageRequestCurrent(unlockRequest);
          if (!snapshot.grantedEpisodeNos.includes(unlockEpisode)) {
            throw new Error('服务端权益尚未同步，请稍后重试');
          }
          if (currentEpisode.value !== unlockEpisode) {
            return;
          }
          await playCurrentEpisode('server_entitled', null, unlockEpisode);
          assertPageRequestCurrent(unlockRequest);
          return;
        }
        if (created.outcome === 'VERIFYING') {
          if (created.nativeProtocol) {
            throw new Error('待确认记录不得携带原生播放协议');
          }
          result = await adSessionOrchestrator.pollSession(identity, created.sessionId);
          assertPageRequestCurrent(unlockRequest);
        } else if (!created.requiresVerificationPoll) {
          if (!created.nativeProtocol) {
            throw new Error('新请求缺少原生播放协议');
          }
          const adPlayback = await runNativeActivityPresentation(() =>
            showDramaRewardedVideoAd({
              protocol: created.nativeProtocol,
              onClientEvent: (clientEvent) =>
                adSessionOrchestrator.recordClientEvent(
                  identity,
                  created.nativeProtocol,
                  clientEvent,
                ),
            }),
          );
          assertPageRequestCurrent(unlockRequest);
          result = await adSessionOrchestrator.pollSession(identity, created.sessionId);
          assertPageRequestCurrent(unlockRequest);
          if (adPlayback.outcome === 'INCOMPLETE' && result.resolution !== 'GRANTED') {
            if (isPageUiRequestCurrent(unlockRequest)) {
              uni.showToast({ title: '广告未完整观看，请重新观看', icon: 'none' });
            }
            return;
          }
        } else {
          result = await adSessionOrchestrator.pollSession(identity, created.sessionId);
          assertPageRequestCurrent(unlockRequest);
        }
      }

      if (result.resolution === 'GRANTED') {
        assertPageRequestCurrent(unlockRequest);
        if (!result.entitlements.grantedEpisodeNos.includes(unlockEpisode)) {
          throw new Error('目标剧集尚未获得服务端权益');
        }
        pageAsyncGuard.invalidateChannel('entitlements');
        releaseUnlockOwnership?.();
        releaseUnlockOwnership = null;
        await waitForPageUiRequestCurrent(unlockRequest);
        assertPageRequestCurrent(unlockRequest);
        grantedEpisodeNos.value = result.entitlements.grantedEpisodeNos;
        uni.showToast({ title: `已解锁第${unlockEpisode}集`, icon: 'none' });
        if (currentEpisode.value !== unlockEpisode) {
          return;
        }
        await playCurrentEpisode(
          'server_verified_reward',
          {
            dramaId,
            episodeNo: unlockEpisode,
            sessionId: result.status.sessionId,
            providerShowId: result.status.providerShowId,
          },
          unlockEpisode,
        );
        assertPageRequestCurrent(unlockRequest);
      } else if (result.resolution === 'VERIFYING') {
        const ownershipTransferred = schedulePendingRewardVerification(
          identity,
          dramaId,
          unlockEpisode,
          result.status.sessionId,
          releaseUnlockOwnership,
        );
        if (ownershipTransferred) {
          releaseUnlockOwnership = null;
        }
        if (isPageUiRequestCurrent(unlockRequest)) {
          uni.showToast({ title: '奖励确认中，可稍后返回查看', icon: 'none' });
        }
      } else {
        const error = new Error('广告奖励未确认');
        error.code =
          result.resolution === 'VERIFY_TIMEOUT' ? 'REWARD_VERIFY_TIMEOUT' : 'REWARD_REJECTED';
        throw error;
      }
    } catch (error) {
      if (
        isStalePageContextError(error) ||
        (unlockRequest && !isPageVisibleRequestCurrent(unlockRequest))
      ) {
        return;
      }
      uni.showToast({
        title: rewardErrorTitle(error),
        icon: 'none',
      });
    } finally {
      releaseUnlockOwnership?.();
      unlocking.value = false;
    }
  }

  function nextEpisode() {
    const next = currentEpisode.value >= drama.value.total ? 1 : currentEpisode.value + 1;
    chooseEpisode(next);
  }

  function toggleDramaFollow() {
    followed.value = toggleFollow(drama.value.id);
    uni.showToast({
      title: followed.value ? '已加入追剧' : '已取消追剧',
      icon: 'none',
    });
  }

  function shareDrama() {
    uni.showToast({
      title: '分享暂不可用',
      icon: 'none',
    });
  }

  onLoad((options) => {
    drama.value = getDramaById(options.id);
    currentEpisode.value = Math.max(1, Math.min(Number(options.episode) || 1, drama.value.total));
    const pages = getCurrentPages();
    pageInstance = pages[pages.length - 1] || null;
    pageAsyncGuard.activate();
    pageAsyncGuard.setVisible(true);
    refresh();
    setTimeout(() => {
      playAfterServerSync('page_load').catch((error) => {
        if (!isStalePageContextError(error)) {
          console.warn('[drama] page authorization unavailable', error?.message || error);
        }
      });
    }, 0);
  });

  onShow(() => {
    pageAsyncGuard.activate();
    pageAsyncGuard.setVisible(true);
    if (!pageHasShown) {
      pageHasShown = true;
      return;
    }
    if (pageAsyncGuard.isPresenting()) {
      foregroundSyncPending = true;
      return;
    }
    foregroundSyncPending = false;
    syncAndResumePendingRawPlayback().catch((error) => {
      if (!isStalePageContextError(error)) {
        console.warn('[drama] foreground playback resume unavailable', error?.message || error);
      }
    });
  });

  onHide(() => {
    cancelPendingDramaRewardedVideoAd();
    pageAsyncGuard.setVisible(false);
    if (pageAsyncGuard.isPresenting()) {
      setTimeout(() => {
        if (!pageAsyncGuard.isVisible() && !isPageInstanceOnTop()) {
          pageAsyncGuard.deactivate();
        }
      }, 0);
      return;
    }
    pageAsyncGuard.deactivate();
  });

  onUnload(() => {
    cancelPendingDramaRewardedVideoAd();
    foregroundSyncPending = false;
    pendingRawPlaybackEpisode = null;
    pageAsyncGuard.setVisible(false);
    pageAsyncGuard.deactivate();
  });

  watch(currentEpisode, () => {
    cancelPendingDramaRewardedVideoAd();
    pageAsyncGuard.invalidateChannel('player');
    pageAsyncGuard.invalidateChannel('unlock');
    videoErrored.value = false;
    pendingRawPlaybackEpisode = null;
    activePlaybackEpisode.value = null;
  });

  watch(
    () => [userStore.userInfo?.tenantId, userStore.userInfo?.userId ?? userStore.userInfo?.id],
    (nextIdentity, previousIdentity) => {
      if (nextIdentity[0] === previousIdentity?.[0] && nextIdentity[1] === previousIdentity?.[1]) {
        return;
      }
      cancelPendingDramaRewardedVideoAd();
      pageAsyncGuard.invalidateRequests();
      authoritativeIdentity.value = '';
      grantedEpisodeNos.value = [];
      pendingRawPlaybackEpisode = null;
      activePlaybackEpisode.value = null;
      if (!pageAsyncGuard.isVisible()) {
        return;
      }
      playAfterServerSync('identity_ready').catch((error) => {
        if (!isStalePageContextError(error)) {
          console.warn('[entitlement] identity refresh unavailable', error?.message || error);
        }
      });
    },
  );
</script>

<style lang="scss" scoped>
  .play-page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    color: #fff;
  }

  .page-mask {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.34), rgba(0, 0, 0, 0.88));
  }

  .header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    padding: 88rpx 24rpx 18rpx;
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64rpx;
    height: 64rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.2);
  }

  .header-title {
    flex: 1;
    margin-left: 18rpx;
    font-size: 30rpx;
    font-weight: 700;
  }

  .video-stage {
    position: relative;
    z-index: 2;
    height: 62vh;
    min-height: 760rpx;
    padding: 0 24rpx;
  }

  .fake-video {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 18rpx;
    background: radial-gradient(circle at 58% 24%, rgba(255, 255, 255, 0.32), transparent 30%),
      rgba(0, 0, 0, 0.28);
    box-shadow: inset 0 0 120rpx rgba(0, 0, 0, 0.32);
  }

  .episode-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #050505;
    pointer-events: none;
  }

  .content-placeholder {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12rpx;
    padding: 48rpx;
    color: #fff;
    text-align: center;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.48));
  }

  .placeholder-title {
    font-size: 34rpx;
    font-weight: 800;
  }

  .placeholder-desc {
    max-width: 520rpx;
    color: rgba(255, 255, 255, 0.72);
    font-size: 24rpx;
    line-height: 1.5;
  }

  .episode-badge {
    position: absolute;
    top: 24rpx;
    left: 24rpx;
    padding: 8rpx 18rpx;
    border-radius: 24rpx;
    background: rgba(0, 0, 0, 0.34);
    font-size: 24rpx;
  }

  .video-copy {
    position: absolute;
    left: 34rpx;
    right: 110rpx;
    bottom: 42rpx;
  }

  .video-title {
    font-size: 42rpx;
    font-weight: 800;
    line-height: 52rpx;
  }

  .video-line {
    margin-top: 14rpx;
    color: rgba(255, 255, 255, 0.82);
    font-size: 28rpx;
    line-height: 40rpx;
  }

  .locked-layer {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    background: rgba(0, 0, 0, 0.72);
    text-align: center;
  }

  .locked-title {
    margin-top: 18rpx;
    font-size: 34rpx;
    font-weight: 800;
  }

  .locked-desc {
    margin-top: 10rpx;
    color: rgba(255, 255, 255, 0.72);
    font-size: 26rpx;
  }

  .unlock-btn {
    height: 74rpx;
    margin-top: 26rpx;
    padding: 0 38rpx;
    border: 0;
    border-radius: 38rpx;
    background: #ff5a1f;
    color: #fff;
    font-size: 28rpx;
    font-weight: 800;
    line-height: 74rpx;
  }

  .side-actions {
    position: absolute;
    right: 38rpx;
    bottom: 48rpx;
    z-index: 3;
  }

  .action {
    display: flex;
    align-items: center;
    flex-direction: column;
    margin-top: 28rpx;
    color: #fff;
    font-size: 22rpx;
  }

  .action text {
    margin-top: 8rpx;
  }

  .bottom-info {
    position: relative;
    z-index: 2;
    padding: 28rpx 30rpx 40rpx;
  }

  .drama-title {
    font-size: 38rpx;
    font-weight: 800;
  }

  .drama-desc {
    margin-top: 12rpx;
    color: rgba(255, 255, 255, 0.76);
    font-size: 26rpx;
    line-height: 38rpx;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    margin-top: 16rpx;
  }

  .meta-row text {
    margin: 0 12rpx 10rpx 0;
    padding: 8rpx 14rpx;
    border-radius: 20rpx;
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.86);
    font-size: 22rpx;
  }

  .bottom-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14rpx 0;
    margin-top: 12rpx;
  }

  .primary-btn,
  .ghost-btn {
    height: 72rpx;
    margin: 0 18rpx 0 0;
    padding: 0 38rpx;
    border: 0;
    border-radius: 38rpx;
    color: #fff;
    font-size: 28rpx;
    font-weight: 800;
    line-height: 72rpx;
  }

  .primary-btn {
    background: #ff5a1f;
  }

  .ghost-btn {
    background: rgba(255, 255, 255, 0.16);
  }

  .episode-mask {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.46);
  }

  .episode-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 11;
    height: 56vh;
    padding: 26rpx 24rpx calc(30rpx + env(safe-area-inset-bottom));
    border-radius: 28rpx 28rpx 0 0;
    background: #fff;
    color: #1f1f1f;
  }

  .episode-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .episode-title {
    font-size: 32rpx;
    font-weight: 800;
  }

  .episode-status {
    margin-top: 8rpx;
    color: #888;
    font-size: 24rpx;
  }

  .follow-btn {
    height: 58rpx;
    margin: 0;
    padding: 0 22rpx;
    border: 1rpx solid #ff5a1f;
    border-radius: 30rpx;
    background: #fff5ef;
    color: #ff5a1f;
    font-size: 24rpx;
    line-height: 58rpx;
  }

  .episode-scroll {
    height: calc(56vh - 132rpx);
    margin-top: 22rpx;
  }

  .episode-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14rpx;
    padding-bottom: 28rpx;
  }

  .episode-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 76rpx;
    border-radius: 12rpx;
    background: #f2f2f2;
    color: #222;
    font-size: 28rpx;
  }

  .episode-item.active {
    background: #fff0e8;
    color: #ff5a1f;
    font-weight: 800;
  }

  .episode-item.locked {
    color: #999;
  }

  .lock-icon {
    position: absolute;
    top: 8rpx;
    right: 8rpx;
  }
</style>
