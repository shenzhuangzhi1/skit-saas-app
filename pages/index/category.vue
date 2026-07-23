<template>
  <view class="theater-page">
    <view class="header">
      <view>
        <view class="title">剧场</view>
        <view class="subtitle">热播短剧和分类剧库</view>
      </view>
      <view class="hot-link" @tap="goHot">
        <uni-icons type="fire-filled" size="18" color="#ff5a1f" />
        <text>热榜</text>
      </view>
    </view>

    <scroll-view scroll-y class="page-scroll">
      <view v-if="contentLoading" class="content-state">
        <uni-icons type="spinner-cycle" size="28" color="#ff5a1f" />
        <view class="state-title">正在加载真实剧场</view>
        <view class="state-desc">热门内容正在同步</view>
      </view>

      <view v-else-if="contentError" class="content-state">
        <uni-icons type="info-filled" size="28" color="#ff5a1f" />
        <view class="state-title">真实剧场加载失败</view>
        <view class="state-desc">{{ contentError }}</view>
        <button class="retry-btn" @tap="refreshPangleContent">重新加载</button>
      </view>

      <template v-else>
        <view class="hot-section">
          <view class="section-head">
            <view class="section-title">热播短剧</view>
            <view class="section-more" @tap="goHot">更多</view>
          </view>
          <scroll-view scroll-x class="horizontal-scroll" :show-scrollbar="false">
            <view class="horizontal-list">
              <DramaCard
                v-for="drama in hotList"
                :key="drama.id"
                mode="compact"
                :drama="drama"
                @select="goPlay(drama, 1)"
              />
            </view>
          </scroll-view>
        </view>

        <view class="category-tabs">
          <view
            v-for="category in categories"
            :key="category"
            class="category-tab"
            :class="{ active: activeCategory === category }"
            @tap="activeCategory = category"
          >
            {{ category }}
          </view>
        </view>

        <view class="drama-grid">
          <DramaCard
            v-for="drama in filteredList"
            :key="drama.id"
            :drama="drama"
            @select="goPlay(drama, 1)"
          />
        </view>
      </template>
    </scroll-view>

    <DramaTabbar active="theater" />
  </view>
</template>

<script setup>
  import { computed, ref } from 'vue';
  import { onShow } from '@dcloudio/uni-app';
  import DramaCard from '@/pages/drama/components/DramaCard.vue';
  import DramaTabbar from '@/pages/drama/components/DramaTabbar.vue';
  import { saveHistory } from '@/pages/drama/data';
  import { getPangleDramaList, openDirectDramaPlayer } from '@/pages/drama/services/pangle-content';

  uni.hideTabBar({
    fail: () => {},
  });

  const activeCategory = ref('全部');
  const sdkList = ref([]);
  const hotList = ref([]);
  const contentLoading = ref(true);
  const contentError = ref('');
  const categories = computed(() => {
    const sdkCategories = sdkList.value.map((item) => item.category).filter(Boolean);
    return ['全部', '热播', ...new Set(sdkCategories)];
  });
  const filteredList = computed(() => {
    if (sdkList.value.length > 0) {
      if (
        !activeCategory.value ||
        activeCategory.value === '全部' ||
        activeCategory.value === '热播'
      ) {
        return sdkList.value;
      }
      return sdkList.value.filter((item) => item.category === activeCategory.value);
    }
    return [];
  });

  async function refreshPangleContent() {
    contentLoading.value = true;
    contentError.value = '';
    try {
      const result = await getPangleDramaList({
        page: 1,
        pageSize: 72,
      });
      if (result.skipped || result.list.length === 0) {
        throw new Error(result.skipped ? '短剧内容服务暂不可用' : '暂未返回可用剧目');
      }
      sdkList.value = result.list;
      hotList.value = result.list.slice(0, 6);
    } catch (error) {
      console.warn('[drama] Pangle theater list unavailable:', error);
      sdkList.value = [];
      hotList.value = [];
      contentError.value = error?.message || '请检查内容授权和网络后重试';
    } finally {
      contentLoading.value = false;
    }
  }

  function goPlay(drama, episode = 1) {
    saveHistory(drama.id, episode);
    openDirectDramaPlayer(drama, episode, 'theater_direct');
  }

  function goHot() {
    uni.navigateTo({
      url: '/pages/drama/hot',
    });
  }

  onShow(() => {
    const intent = uni.getStorageSync('skit_drama_category_intent');
    if (intent) {
      activeCategory.value = intent;
      uni.removeStorageSync('skit_drama_category_intent');
    }
    refreshPangleContent();
  });
</script>

<style lang="scss" scoped>
  .theater-page {
    min-height: 100vh;
    background: #f6f6f6;
    color: #1f1f1f;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 92rpx 28rpx 22rpx;
    background: #fff;
  }

  .title {
    color: #141414;
    font-size: 42rpx;
    font-weight: 800;
    line-height: 50rpx;
  }

  .subtitle {
    margin-top: 6rpx;
    color: #8c8c8c;
    font-size: 24rpx;
  }

  .hot-link {
    display: flex;
    align-items: center;
    height: 60rpx;
    padding: 0 20rpx;
    border-radius: 34rpx;
    background: #fff3ed;
    color: #ff5a1f;
    font-size: 24rpx;
    font-weight: 700;
  }

  .hot-link text {
    margin-left: 6rpx;
  }

  .page-scroll {
    height: calc(100vh - 164rpx);
  }

  .content-state {
    display: flex;
    min-height: 620rpx;
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

  .hot-section {
    padding: 26rpx 24rpx;
    background: #fff;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18rpx;
  }

  .section-title {
    font-size: 34rpx;
    font-weight: 800;
  }

  .section-more {
    color: #999;
    font-size: 24rpx;
  }

  .horizontal-scroll {
    width: 100%;
    white-space: nowrap;
  }

  .horizontal-list {
    display: flex;
  }

  .category-tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    overflow-x: auto;
    padding: 22rpx 24rpx 14rpx;
    background: #f6f6f6;
    white-space: nowrap;
  }

  .category-tab {
    flex-shrink: 0;
    margin-right: 16rpx;
    padding: 14rpx 24rpx;
    border-radius: 32rpx;
    background: #fff;
    color: #666;
    font-size: 26rpx;
  }

  .category-tab.active {
    background: #1f1f1f;
    color: #fff;
    font-weight: 700;
  }

  .drama-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28rpx 18rpx;
    padding: 10rpx 24rpx 156rpx;
  }
</style>
