<template>
  <view class="list-page">
    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="23" color="#222" />
      </view>
      <view>
        <view class="title">热门短剧</view>
        <view class="subtitle">按热度排序的短剧榜单</view>
      </view>
    </view>

    <scroll-view scroll-y class="page-scroll">
      <view class="rank-list">
        <view v-for="(drama, index) in list" :key="drama.id" class="rank-item" @tap="goPlay(drama)">
          <view class="rank-no" :class="{ top: index < 3 }">{{ index + 1 }}</view>
          <view class="poster" :style="{ background: drama.cover }">
            <view class="poster-title">{{ drama.title }}</view>
          </view>
          <view class="rank-info">
            <view class="rank-title ss-line-1">{{ drama.title }}</view>
            <view class="rank-desc ss-line-2">{{ drama.desc }}</view>
            <view class="rank-meta"
              >{{ drama.heat }} · {{ drama.status }} · {{ drama.total }}集</view
            >
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
  import { getHotDramas, saveHistory } from '@/pages/drama/data';
  import { openDirectDramaPlayer } from '@/pages/drama/services/pangle-content';

  const list = getHotDramas();

  function goBack() {
    uni.navigateBack();
  }

  function goPlay(drama) {
    saveHistory(drama.id, 1);
    openDirectDramaPlayer(drama, 1, 'hot_direct');
  }
</script>

<style lang="scss" scoped>
  .list-page {
    min-height: 100vh;
    background: #f6f6f6;
    color: #202020;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 88rpx 24rpx 22rpx;
    background: #fff;
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64rpx;
    height: 64rpx;
    margin-right: 18rpx;
    border-radius: 50%;
    background: #f3f3f3;
  }

  .title {
    font-size: 38rpx;
    font-weight: 800;
    line-height: 46rpx;
  }

  .subtitle {
    margin-top: 6rpx;
    color: #8a8a8a;
    font-size: 24rpx;
  }

  .page-scroll {
    height: calc(100vh - 174rpx);
  }

  .rank-list {
    padding: 22rpx 24rpx 34rpx;
  }

  .rank-item {
    display: flex;
    align-items: center;
    margin-bottom: 18rpx;
    padding: 18rpx;
    border-radius: 18rpx;
    background: #fff;
  }

  .rank-no {
    width: 54rpx;
    color: #999;
    font-size: 32rpx;
    font-weight: 800;
    text-align: center;
  }

  .rank-no.top {
    color: #ff5a1f;
  }

  .poster {
    position: relative;
    flex-shrink: 0;
    width: 132rpx;
    height: 176rpx;
    margin-left: 12rpx;
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

  .rank-info {
    flex: 1;
    min-width: 0;
    margin-left: 20rpx;
  }

  .rank-title {
    font-size: 31rpx;
    font-weight: 800;
  }

  .rank-desc {
    margin-top: 10rpx;
    color: #777;
    font-size: 25rpx;
    line-height: 36rpx;
  }

  .rank-meta {
    margin-top: 12rpx;
    color: #ff5a1f;
    font-size: 23rpx;
  }
</style>
