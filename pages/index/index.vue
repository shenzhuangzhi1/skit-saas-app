<template>
  <view class="drama-home">
    <view class="topbar">
      <view>
        <view class="brand">短剧 SaaS</view>
        <view class="subtitle">热播短剧与每日上新</view>
      </view>
      <view class="search" @tap="goSearch">
        <uni-icons type="search" size="18" color="#7c7c7c" />
        <text>搜短剧</text>
      </view>
    </view>

    <view class="home-tabs">
      <view
        v-for="tab in tabs"
        :key="tab.key"
        class="home-tab"
        :class="{ active: activeTab === tab.key }"
        @tap="activeTab = tab.key"
      >
        {{ tab.text }}
      </view>
    </view>

    <scroll-view scroll-y class="content-scroll">
      <view
        v-if="activeTab === 'recommend'"
        class="content"
        :class="{ 'banner-active': homeBannerVisible }"
      >
        <view v-if="contentLoading" class="content-state">
          <uni-icons type="spinner-cycle" size="28" color="#ff5a1f" />
          <view class="state-title">正在加载真实剧单</view>
          <view class="state-desc">热门内容正在同步</view>
        </view>

        <view v-else-if="contentError" class="content-state">
          <uni-icons type="info-filled" size="28" color="#ff5a1f" />
          <view class="state-title">真实剧单加载失败</view>
          <view class="state-desc">{{ contentError }}</view>
          <button class="retry-btn" @tap="refreshPangleContent">重新加载</button>
        </view>

        <template v-else>
          <view class="hero" :style="{ background: featured.cover }">
            <view class="hero-mask"></view>
            <view class="hero-content">
              <view class="hero-label">正在热播</view>
              <view class="hero-title">{{ featured.title }}</view>
              <view class="hero-desc">{{ featured.desc }}</view>
              <view class="hero-tags">
                <text v-for="tag in featured.tags" :key="tag">{{ tag }}</text>
              </view>
              <view class="hero-actions">
                <button class="primary-btn" @tap.stop="goPlay(featured, 1)"> 立即播放 </button>
                <button class="ghost-btn" @tap.stop="followFeatured">
                  {{ featuredFollowed ? '已追剧' : '加入追剧' }}
                </button>
              </view>
            </view>
          </view>

          <view
            v-if="latestHistory"
            class="continue-card"
            @tap="goPlay(latestHistory.drama, latestHistory.episode)"
          >
            <view class="continue-copy">
              <view class="section-kicker">继续观看</view>
              <view class="continue-title">{{ latestHistory.drama.title }}</view>
              <view class="continue-meta">上次看到第{{ latestHistory.episode }}集</view>
            </view>
            <view class="continue-action">
              <view class="play-triangle"></view>
            </view>
          </view>

          <view class="section">
            <view class="section-head">
              <view>
                <view class="section-title">推荐短剧</view>
                <view class="section-subtitle">热门内容实时更新</view>
              </view>
            </view>
            <scroll-view scroll-x class="horizontal-scroll" :show-scrollbar="false">
              <view class="horizontal-list">
                <DramaCard
                  v-for="drama in recommendList"
                  :key="drama.id"
                  mode="compact"
                  :drama="drama"
                  @select="goPlay(drama, 1)"
                />
              </view>
            </scroll-view>
          </view>

          <view class="section">
            <view class="section-head">
              <view class="section-title">热门题材</view>
              <view class="more" @tap="goTheater">去剧场</view>
            </view>
            <view class="genre-grid">
              <view
                v-for="category in categories"
                :key="category"
                class="genre-item"
                @tap="goTheater(category)"
              >
                <view class="genre-name">{{ category }}</view>
                <view class="genre-meta">查看{{ category }}短剧</view>
              </view>
            </view>
          </view>
        </template>
      </view>

      <view v-else class="content history-content" :class="{ 'banner-active': homeBannerVisible }">
        <view v-if="historyList.length > 0" class="history-grid">
          <DramaCard
            v-for="item in historyList"
            :key="item.id"
            :drama="item.drama"
            :episode="item.episode"
            @select="goPlay(item.drama, item.episode)"
          />
        </view>
        <view v-else class="empty-state">
          <view class="empty-title">还没有观看历史</view>
          <view class="empty-desc">从推荐短剧开始试看，播放记录会出现在这里。</view>
          <button class="primary-btn empty-btn" @tap="activeTab = 'recommend'">去看推荐</button>
        </view>
      </view>
    </scroll-view>

    <DramaTabbar active="home" />
  </view>
</template>

<script setup>
  import { computed, onMounted, onUnmounted, ref } from 'vue';
  import { onHide, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app';
  import sheep from '@/sheep';
  import DramaCard from '@/pages/drama/components/DramaCard.vue';
  import DramaTabbar from '@/pages/drama/components/DramaTabbar.vue';
  import {
    cacheExternalDramas,
    getHistoryList,
    isFollowed,
    saveHistory,
    toggleFollow,
  } from '@/pages/drama/data';
  import { getPangleDramaList, openDirectDramaPlayer } from '@/pages/drama/services/pangle-content';
  import {
    createPageVisitGuard,
    DISPLAY_AD_SCENES,
    displayAdFlow,
    resolveDisplayPlacements,
  } from '@/pages/drama/services/display-ad-flow.mjs';

  uni.hideTabBar({
    fail: () => {},
  });

  const tabs = [
    { key: 'history', text: '历史观看' },
    { key: 'recommend', text: '推荐' },
  ];
  const activeTab = ref('recommend');
  const featured = ref(null);
  const historyList = ref([]);
  const featuredFollowed = ref(false);
  const recommendList = ref([]);
  const contentLoading = ref(true);
  const contentError = ref('');
  const homeBannerVisible = ref(false);
  const homeVisible = ref(false);
  const bannerEpoch = ref(0);
  const BANNER_LIFECYCLE_EVENT = 'skit:taku-banner-lifecycle';
  const homeVisitGuard = createPageVisitGuard();
  const userStore = sheep.$store('user');
  const categories = computed(() =>
    [featured.value, ...recommendList.value]
      .map((item) => item?.category)
      .filter((item, index, list) => item && list.indexOf(item) === index)
      .slice(0, 6),
  );

  const latestHistory = computed(() => historyList.value[0]);

  async function refresh() {
    await refreshPangleContent();
    historyList.value = getHistoryList();
    featuredFollowed.value = featured.value ? isFollowed(featured.value.id) : false;
  }

  async function refreshPangleContent() {
    contentLoading.value = true;
    contentError.value = '';
    try {
      const result = await getPangleDramaList({ page: 1, pageSize: 72 });
      if (result.skipped || result.list.length === 0) {
        throw new Error(result.skipped ? '短剧内容服务暂不可用' : '暂未返回可用剧目');
      }
      cacheExternalDramas(result.list);
      featured.value = result.list[0];
      recommendList.value = result.list.slice(1);
    } catch (error) {
      console.warn('[drama] Pangle drama list unavailable:', error);
      featured.value = null;
      recommendList.value = [];
      contentError.value = error?.message || '请检查内容授权和网络后重试';
    } finally {
      contentLoading.value = false;
    }
  }

  async function loadDisplayAdConfig() {
    try {
      await userStore.getAdConfig();
    } catch (error) {
      console.warn('[display-ad] public placement config unavailable', error);
    }
    return resolveDisplayPlacements(userStore.adConfig);
  }

  async function showHomeBanner() {
    const requestEpoch = bannerEpoch.value;
    const placements = await loadDisplayAdConfig();
    if (!homeVisible.value || requestEpoch !== bannerEpoch.value) {
      await displayAdFlow.hideHomeBanner();
      return;
    }
    const result = await displayAdFlow.showHomeBanner(placements.homeBanner);
    if (!homeVisible.value || requestEpoch !== bannerEpoch.value) {
      homeBannerVisible.value = false;
      await displayAdFlow.hideHomeBanner();
      return;
    }
    homeBannerVisible.value = result.shown === true;
  }

  async function hideHomeBanner() {
    bannerEpoch.value += 1;
    homeBannerVisible.value = false;
    await displayAdFlow.hideHomeBanner();
  }

  async function goPlay(drama, episode = 1) {
    const visitEpoch = homeVisitGuard.capture();
    const opened = await openDirectDramaPlayer(drama, episode, 'home_direct', {
      beforePlay: hideHomeBanner,
      canOpenPlayer: () => homeVisitGuard.isCurrent(visitEpoch),
      presentInterstitial: (operation) => homeVisitGuard.runPresentation(visitEpoch, operation),
    });
    if (opened) {
      saveHistory(drama.id, episode);
    }
  }

  function followFeatured() {
    if (!featured.value) return;
    featuredFollowed.value = toggleFollow(featured.value.id);
    uni.showToast({
      title: featuredFollowed.value ? '已加入追剧' : '已取消追剧',
      icon: 'none',
    });
  }

  function goTheater(category = '') {
    if (category) {
      uni.setStorageSync('skit_drama_category_intent', category);
    }
    uni.switchTab({
      url: '/pages/index/category',
    });
  }

  function goSearch() {
    uni.navigateTo({
      url: '/pages/index/search',
    });
  }

  function handleBannerLifecycle(event) {
    const detail = event?.detail;
    if (detail?.state === 'CLOSED' && detail?.scene === DISPLAY_AD_SCENES.HOME_BANNER) {
      homeBannerVisible.value = false;
    }
  }

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener(BANNER_LIFECYCLE_EVENT, handleBannerLifecycle);
    }
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener(BANNER_LIFECYCLE_EVENT, handleBannerLifecycle);
    }
  });

  onShow(async () => {
    homeVisible.value = true;
    homeVisitGuard.enter();
    bannerEpoch.value += 1;
    await refresh();
    if (!homeVisible.value) {
      return;
    }
    await showHomeBanner();
  });

  onHide(() => {
    homeVisible.value = false;
    homeVisitGuard.leave();
    bannerEpoch.value += 1;
    homeBannerVisible.value = false;
    void displayAdFlow.hideHomeBanner();
  });

  onUnload(() => {
    homeVisitGuard.unload();
  });

  onPullDownRefresh(async () => {
    await refresh();
    if (homeVisible.value) {
      await showHomeBanner();
    }
    uni.stopPullDownRefresh();
  });
</script>

<style lang="scss" scoped>
  .drama-home {
    min-height: 100vh;
    background: #f6f6f6;
    color: #1f1f1f;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 92rpx 28rpx 20rpx;
    background: #fff;
  }

  .brand {
    color: #161616;
    font-size: 40rpx;
    font-weight: 800;
    line-height: 48rpx;
  }

  .subtitle {
    margin-top: 6rpx;
    color: #8b8b8b;
    font-size: 22rpx;
  }

  .search {
    display: flex;
    align-items: center;
    height: 64rpx;
    padding: 0 22rpx;
    border-radius: 36rpx;
    background: #f1f1f1;
    color: #777;
    font-size: 24rpx;
  }

  .search text {
    margin-left: 8rpx;
  }

  .home-tabs {
    display: flex;
    align-items: flex-end;
    height: 76rpx;
    padding: 0 28rpx;
    background: #fff;
  }

  .home-tab {
    position: relative;
    margin-right: 36rpx;
    padding-bottom: 18rpx;
    color: #777;
    font-size: 30rpx;
    line-height: 38rpx;
  }

  .home-tab.active {
    color: #111;
    font-size: 38rpx;
    font-weight: 800;
  }

  .home-tab.active::after {
    content: '';
    position: absolute;
    left: 6rpx;
    bottom: 8rpx;
    width: 42rpx;
    height: 8rpx;
    border-radius: 8rpx;
    background: #ff5a1f;
  }

  .content-scroll {
    height: calc(100vh - 252rpx);
  }

  .content {
    padding: 24rpx 24rpx 150rpx;
  }

  .content.banner-active {
    padding-bottom: 282rpx;
  }

  .content-state {
    display: flex;
    min-height: 520rpx;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 48rpx;
    text-align: center;
  }

  .state-title {
    margin-top: 20rpx;
    color: #1f1f1f;
    font-size: 32rpx;
    font-weight: 800;
  }

  .state-desc {
    margin-top: 12rpx;
    color: #888;
    font-size: 24rpx;
    line-height: 36rpx;
  }

  .retry-btn {
    height: 68rpx;
    margin-top: 28rpx;
    padding: 0 32rpx;
    border: 0;
    border-radius: 34rpx;
    background: #ff5a1f;
    color: #fff;
    font-size: 26rpx;
    line-height: 68rpx;
  }

  .hero {
    position: relative;
    min-height: 640rpx;
    overflow: hidden;
    border-radius: 18rpx;
  }

  .hero-mask {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 70% 18%, rgba(255, 255, 255, 0.34), transparent 30%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0.72));
  }

  .hero-content {
    position: absolute;
    left: 30rpx;
    right: 30rpx;
    bottom: 34rpx;
    color: #fff;
  }

  .hero-label,
  .section-kicker {
    color: #ffd8c5;
    font-size: 24rpx;
    font-weight: 600;
  }

  .hero-title {
    margin-top: 14rpx;
    font-size: 48rpx;
    font-weight: 800;
    line-height: 58rpx;
  }

  .hero-desc {
    margin-top: 16rpx;
    color: rgba(255, 255, 255, 0.88);
    font-size: 28rpx;
    line-height: 40rpx;
  }

  .hero-tags {
    display: flex;
    flex-wrap: wrap;
    margin-top: 18rpx;
  }

  .hero-tags text {
    margin: 0 12rpx 12rpx 0;
    padding: 8rpx 14rpx;
    border-radius: 20rpx;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 22rpx;
  }

  .hero-actions {
    display: flex;
    margin-top: 14rpx;
  }

  .primary-btn,
  .ghost-btn {
    height: 72rpx;
    margin: 0 18rpx 0 0;
    padding: 0 34rpx;
    border: 0;
    border-radius: 38rpx;
    font-size: 28rpx;
    font-weight: 700;
    line-height: 72rpx;
  }

  .primary-btn {
    background: #ff5a1f;
    color: #fff;
  }

  .ghost-btn {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
  }

  .continue-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 22rpx;
    padding: 24rpx;
    border-radius: 16rpx;
    background: #1f1f1f;
    color: #fff;
  }

  .continue-title {
    margin-top: 8rpx;
    font-size: 30rpx;
    font-weight: 700;
  }

  .continue-meta {
    margin-top: 4rpx;
    color: rgba(255, 255, 255, 0.66);
    font-size: 24rpx;
  }

  .continue-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    background: #ff5a1f;
  }

  .play-triangle {
    width: 0;
    height: 0;
    margin-left: 6rpx;
    border-top: 14rpx solid transparent;
    border-bottom: 14rpx solid transparent;
    border-left: 22rpx solid #fff;
  }

  .section {
    margin-top: 30rpx;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18rpx;
  }

  .section-title {
    color: #191919;
    font-size: 34rpx;
    font-weight: 800;
    line-height: 42rpx;
  }

  .section-subtitle,
  .more {
    margin-top: 6rpx;
    color: #8a8a8a;
    font-size: 24rpx;
  }

  .more {
    color: #ff5a1f;
    font-weight: 700;
  }

  .horizontal-scroll {
    width: 100%;
    white-space: nowrap;
  }

  .horizontal-list {
    display: flex;
  }

  .genre-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18rpx;
  }

  .genre-item {
    padding: 24rpx;
    border-radius: 16rpx;
    background: #fff;
  }

  .genre-name {
    color: #202020;
    font-size: 30rpx;
    font-weight: 700;
  }

  .genre-meta {
    margin-top: 8rpx;
    color: #8d8d8d;
    font-size: 24rpx;
  }

  .history-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 26rpx 18rpx;
  }

  .empty-state {
    margin-top: 160rpx;
    padding: 50rpx 34rpx;
    border-radius: 18rpx;
    background: #fff;
    text-align: center;
  }

  .empty-title {
    color: #1f1f1f;
    font-size: 34rpx;
    font-weight: 800;
  }

  .empty-desc {
    margin-top: 12rpx;
    color: #888;
    font-size: 26rpx;
    line-height: 38rpx;
  }

  .empty-btn {
    display: inline-block;
    margin-top: 28rpx;
  }
</style>
