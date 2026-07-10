<template>
  <view class="search-page">
    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="23" color="#222" />
      </view>
      <uni-search-bar
        class="search-input"
        radius="33"
        placeholder="搜索短剧名称、题材"
        cancelButton="none"
        :focus="true"
        v-model="keyword"
        @confirm="onSearch($event.value)"
      />
    </view>

    <scroll-view scroll-y class="page-scroll">
      <view v-if="keyword && resultList.length > 0" class="result-list">
        <view v-for="drama in resultList" :key="drama.id" class="result-item" @tap="goPlay(drama)">
          <view class="poster" :style="{ background: drama.cover }">
            <view class="poster-title">{{ drama.title }}</view>
          </view>
          <view class="result-info">
            <view class="result-title ss-line-1">{{ drama.title }}</view>
            <view class="result-desc ss-line-2">{{ drama.desc }}</view>
            <view class="tag-row">
              <text v-for="tag in drama.tags" :key="tag">{{ tag }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-else-if="keyword" class="empty-state">
        <view class="empty-title">没有找到相关短剧</view>
        <view class="empty-desc">换个剧名、题材或关键词试试。</view>
      </view>

      <view v-else class="history-section">
        <view class="history-head">
          <view class="section-title">搜索历史</view>
          <button class="clean-history" @tap="onDelete">清除</button>
        </view>
        <view class="history-list">
          <button v-for="item in historyList" :key="item" class="history-btn" @tap="onSearch(item)">
            {{ item }}
          </button>
        </view>

        <view class="section-title recommend-title">热门搜索</view>
        <view class="history-list">
          <button
            v-for="item in hotKeywords"
            :key="item"
            class="history-btn hot"
            @tap="onSearch(item)"
          >
            {{ item }}
          </button>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
  import { computed, ref } from 'vue';
  import { onLoad } from '@dcloudio/uni-app';
  import { DRAMAS, saveHistory } from '@/pages/drama/data';

  const STORAGE_KEY = 'skit_drama_search_history_v1';
  const keyword = ref('');
  const historyList = ref([]);
  const hotKeywords = ['重生', '甜宠', '商战', '悬疑', '古装'];

  const resultList = computed(() => {
    const word = keyword.value.trim().toLowerCase();
    if (!word) {
      return [];
    }
    return DRAMAS.filter((drama) => {
      const text = `${drama.title} ${drama.category} ${drama.tags.join(' ')} ${
        drama.desc
      }`.toLowerCase();
      return text.includes(word);
    });
  });

  function onSearch(value) {
    const word = String(value || '').trim();
    if (!word) {
      return;
    }
    keyword.value = word;
    saveSearchHistory(word);
  }

  function saveSearchHistory(word) {
    historyList.value = historyList.value.filter((item) => item !== word);
    historyList.value.unshift(word);
    historyList.value = historyList.value.slice(0, 10);
    uni.setStorageSync(STORAGE_KEY, historyList.value);
  }

  function onDelete() {
    historyList.value = [];
    uni.removeStorageSync(STORAGE_KEY);
  }

  function goBack() {
    uni.navigateBack();
  }

  function goPlay(drama) {
    saveHistory(drama.id, 1);
    uni.navigateTo({
      url: `/pages/drama/play?id=${encodeURIComponent(drama.id)}&episode=1`,
    });
  }

  onLoad(() => {
    historyList.value = uni.getStorageSync(STORAGE_KEY) || [];
  });
</script>

<style lang="scss" scoped>
  .search-page {
    min-height: 100vh;
    background: #f6f6f6;
    color: #202020;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 86rpx 18rpx 18rpx;
    background: #fff;
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64rpx;
    height: 64rpx;
    margin-right: 8rpx;
    border-radius: 50%;
    background: #f3f3f3;
  }

  .search-input {
    flex: 1;
  }

  .page-scroll {
    height: calc(100vh - 168rpx);
  }

  .history-section,
  .result-list {
    padding: 24rpx;
  }

  .history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 32rpx;
    font-weight: 800;
  }

  .clean-history {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: #999;
    font-size: 24rpx;
    line-height: 34rpx;
  }

  .history-list {
    display: flex;
    flex-wrap: wrap;
    margin-top: 18rpx;
  }

  .history-btn {
    height: 62rpx;
    margin: 0 16rpx 16rpx 0;
    padding: 0 26rpx;
    border: 0;
    border-radius: 32rpx;
    background: #fff;
    color: #333;
    font-size: 26rpx;
    line-height: 62rpx;
  }

  .history-btn.hot {
    background: #fff3ed;
    color: #ff5a1f;
  }

  .recommend-title {
    margin-top: 34rpx;
  }

  .result-item {
    display: flex;
    margin-bottom: 18rpx;
    padding: 18rpx;
    border-radius: 18rpx;
    background: #fff;
  }

  .poster {
    position: relative;
    flex-shrink: 0;
    width: 138rpx;
    height: 184rpx;
    overflow: hidden;
    border-radius: 12rpx;
  }

  .poster::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.62));
  }

  .poster-title {
    position: absolute;
    left: 10rpx;
    right: 10rpx;
    bottom: 12rpx;
    z-index: 1;
    color: #fff;
    font-size: 22rpx;
    font-weight: 700;
    line-height: 28rpx;
  }

  .result-info {
    flex: 1;
    min-width: 0;
    margin-left: 20rpx;
  }

  .result-title {
    font-size: 31rpx;
    font-weight: 800;
  }

  .result-desc {
    margin-top: 10rpx;
    color: #777;
    font-size: 25rpx;
    line-height: 36rpx;
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    margin-top: 12rpx;
  }

  .tag-row text {
    margin: 0 10rpx 10rpx 0;
    padding: 6rpx 12rpx;
    border-radius: 18rpx;
    background: #fff3ed;
    color: #ff5a1f;
    font-size: 22rpx;
  }

  .empty-state {
    margin: 170rpx 24rpx 0;
    padding: 58rpx 34rpx;
    border-radius: 18rpx;
    background: #fff;
    text-align: center;
  }

  .empty-title {
    font-size: 34rpx;
    font-weight: 800;
  }

  .empty-desc {
    margin-top: 12rpx;
    color: #888;
    font-size: 26rpx;
  }
</style>
