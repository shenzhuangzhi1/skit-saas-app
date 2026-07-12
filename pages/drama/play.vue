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
            {{ pangleReady ? '穿山甲短剧播放器已就绪' : '真实短剧资源未接入' }}
          </view>
          <view class="placeholder-desc">
            {{
              pangleReady
                ? '将通过穿山甲短剧 SDK 打开真实剧集'
                : '需要接入穿山甲短剧 SDK 或配置 episode.videoUrl'
            }}
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
          打开真实播放器
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
  import { onLoad, onShow } from '@dcloudio/uni-app';
  import sheep from '@/sheep';
  import AdRevenueApi from '@/sheep/api/member/ad-revenue';
  import {
    getDramaById,
    getUnlockRange,
    isEpisodeUnlocked,
    isFollowed,
    saveHistory,
    toggleFollow,
    unlockEpisodes,
  } from '@/pages/drama/data';
  import {
    hasPangleDramaId,
    isPangleContentReady,
    openPangleDramaPlayer,
  } from '@/pages/drama/services/pangle-content';
  import { showDramaRewardedVideoAd } from '@/pages/drama/services/reward-ad';

  const drama = ref(getDramaById());
  const currentEpisode = ref(1);
  const followed = ref(false);
  const unlockedVersion = ref(0);
  const showEpisodePanel = ref(false);
  const unlocking = ref(false);
  const videoErrored = ref(false);
  const pangleReady = ref(false);
  const userStore = sheep.$store('user');

  const locked = computed(() => {
    unlockedVersion.value;
    return !isEpisodeUnlocked(drama.value, currentEpisode.value);
  });

  const currentEpisodeTitle = computed(() => {
    return drama.value.episodes[currentEpisode.value - 1]?.title || `第${currentEpisode.value}集`;
  });

  const currentLine = computed(() => {
    const lines = drama.value.lines || [];
    return lines[(currentEpisode.value - 1) % lines.length] || drama.value.desc;
  });

  const currentVideoUrl = computed(() => {
    return drama.value.episodes[currentEpisode.value - 1]?.videoUrl || drama.value.videoUrl || '';
  });

  const canOpenPanglePlayer = computed(() => {
    return (
      pangleReady.value && hasPangleDramaId(drama.value) && !currentVideoUrl.value && !locked.value
    );
  });

  const unlockRangeText = computed(() => {
    const range = getUnlockRange(drama.value, currentEpisode.value);
    if (range.length === 0) {
      return currentEpisode.value;
    }
    if (range.length === 1) {
      return range[0];
    }
    return `${range[0]}-${range[range.length - 1]}`;
  });

  function refresh() {
    followed.value = isFollowed(drama.value.id);
    pangleReady.value = isPangleContentReady() && hasPangleDramaId(drama.value);
    unlockedVersion.value += 1;
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
    unlockedVersion.value;
    return isEpisodeUnlocked(drama.value, episode);
  }

  function handleVideoPlay() {
    saveHistory(drama.value.id, currentEpisode.value);
  }

  function handleVideoError(error) {
    videoErrored.value = true;
    console.warn('[drama] video playback failed:', currentVideoUrl.value, error);
  }

  function assertAdBuildProfile(provider, providerConfig) {
    const expectedAgentCode = String(import.meta.env?.VITE_SKIT_AGENT_CODE || '').toUpperCase();
    const currentTenantCode = String(userStore.userInfo?.tenantCode || '').toUpperCase();
    if (!expectedAgentCode || !currentTenantCode) {
      throw new Error('代理商白标身份尚未就绪，暂不能展示广告');
    }
    if (expectedAgentCode !== currentTenantCode) {
      throw new Error('当前安装包不属于该代理商，请使用所属代理商的白标 App');
    }
    const builtAppId = String(
      provider === 'taku'
        ? import.meta.env?.VITE_TAKU_APP_ID || ''
        : import.meta.env?.VITE_PANGLE_APP_ID || '',
    );
    const configuredAppId = String(providerConfig?.appId || '');
    if (!builtAppId || !configuredAppId) {
      throw new Error('广告 App ID 未完整配置，暂不能展示广告');
    }
    if (builtAppId !== configuredAppId) {
      throw new Error('广告账号与当前白标包不匹配，请重新安装正确版本');
    }
  }

  function resolveVerifiedAdConfig() {
    const adConfig = userStore.adConfig || {};
    const configuredProvider = String(adConfig.provider || '').toLowerCase();
    const builtProvider = String(import.meta.env?.VITE_DRAMA_AD_PROVIDER || '').toLowerCase();
    if (configuredProvider === 'none' || !configuredProvider) {
      throw new Error('当前代理商未启用广告账号');
    }

    const provider = configuredProvider === 'multi' ? builtProvider : configuredProvider;
    if (!['pangle', 'taku'].includes(provider)) {
      throw new Error('当前白标包未指定可用的广告平台');
    }
    if (!builtProvider || builtProvider !== provider) {
      throw new Error('广告平台与当前白标包不匹配，请重新安装正确版本');
    }

    const providerConfig = adConfig[provider];
    if (!providerConfig || providerConfig.enabled !== true) {
      throw new Error('当前代理商的广告账号未启用');
    }
    const placementId = String(providerConfig.placementId || '').trim();
    if (!placementId) {
      throw new Error('当前代理商未配置广告位');
    }
    assertAdBuildProfile(provider, providerConfig);
    return { provider, placementId };
  }

  async function playCurrentEpisode(source) {
    if (!isUnlocked(currentEpisode.value)) {
      return;
    }

    if (currentVideoUrl.value) {
      return;
    }

    if (!hasPangleDramaId(drama.value)) {
      return;
    }

    const result = await openPangleDramaPlayer({
      drama: drama.value,
      episode: currentEpisode.value,
      source,
    }).catch((error) => {
      console.warn('[drama] Pangle player open failed:', error);
      return { skipped: true, reason: error?.message || 'pangle-open-failed' };
    });

    if (result?.skipped && source === 'manual_open') {
      uni.showToast({
        title: '当前剧目没有真实 SDK ID',
        icon: 'none',
      });
    }
  }

  function chooseEpisode(episode) {
    currentEpisode.value = episode;
    saveHistory(drama.value.id, episode);
    showEpisodePanel.value = false;
    if (!isUnlocked(episode)) {
      uni.showToast({
        title: `第${episode}集需要解锁`,
        icon: 'none',
      });
      return;
    }
    playCurrentEpisode('episode_select');
  }

  async function unlockCurrent() {
    if (unlocking.value) {
      return;
    }
    const range = getUnlockRange(drama.value, currentEpisode.value);
    if (range.length === 0) {
      return;
    }
    if (!userStore.isLogin) {
      uni.navigateTo({
        url: '/pages/auth/index?mode=login',
      });
      return;
    }

    unlocking.value = true;
    try {
      const { provider, placementId } = resolveVerifiedAdConfig();
      const reward = await showDramaRewardedVideoAd({
        provider,
        placementId,
        scene: 'drama_unlock',
        dramaId: drama.value.id,
        episode: currentEpisode.value,
        unlockRange: range,
      });
      const unlockedText = range.length === 1 ? range[0] : `${range[0]}-${range[range.length - 1]}`;
      unlockEpisodes(drama.value.id, range);
      unlockedVersion.value += 1;
      reportAdRevenue(reward, provider, placementId);
      uni.showToast({
        title: reward.mock
          ? `开发模拟广告，已解锁第${unlockedText}集`
          : `已解锁第${unlockedText}集`,
        icon: 'none',
      });
      playCurrentEpisode('reward_unlock');
    } catch (error) {
      uni.showToast({
        title: error?.message || '广告暂不可用',
        icon: 'none',
      });
    } finally {
      unlocking.value = false;
    }
  }

  function reportAdRevenue(reward, fallbackProvider, fallbackPlacementId) {
    if (!reward?.completed || reward.mock) {
      return;
    }
    const raw = reward.raw || {};
    const adInfo = raw.adInfo || raw.ad_info || {};
    const externalEventId = String(
      adInfo.requestId || raw.requestId || raw.request_id || '',
    ).trim();
    const ecpm = Number(adInfo.ecpm ?? raw.ecpm);
    if (!externalEventId || !Number.isFinite(ecpm) || ecpm <= 0) {
      console.warn('[ad-revenue] missing requestId/ecpm; skip estimated commission report');
      return;
    }
    const provider = String(
      reward.provider || raw.provider || fallbackProvider || '',
    ).toUpperCase();
    const placementId =
      reward.placementId || adInfo.placementId || raw.placementId || fallbackPlacementId || '';
    AdRevenueApi.report({
      provider: provider === 'GROMORE' ? 'PANGLE' : provider,
      externalEventId,
      placementId,
      grossAmount: (ecpm / 1000).toFixed(8),
      occurredTime: new Date().toISOString(),
      completed: true,
      mock: false,
      rawData: raw,
    }).catch((error) => {
      console.warn('[ad-revenue] report failed', error);
    });
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
      title: '分享能力待接入平台 SDK',
      icon: 'none',
    });
  }

  onLoad((options) => {
    drama.value = getDramaById(options.id);
    currentEpisode.value = Math.max(1, Math.min(Number(options.episode) || 1, drama.value.total));
    saveHistory(drama.value.id, currentEpisode.value);
    refresh();
    setTimeout(() => playCurrentEpisode('page_load'), 0);
  });

  onShow(refresh);

  watch(currentEpisode, () => {
    videoErrored.value = false;
  });
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
