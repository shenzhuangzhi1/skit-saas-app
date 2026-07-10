<template>
  <view class="follow-page">
    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="23" color="#222" />
      </view>
      <view>
        <view class="title">我的追剧</view>
        <view class="subtitle">同步参考项目的追剧入口</view>
      </view>
    </view>

    <scroll-view scroll-y class="page-scroll">
      <view v-if="list.length > 0" class="drama-grid">
        <DramaCard
          v-for="item in list"
          :key="item.id"
          :drama="item.drama"
          :episode="item.episode"
          @select="goPlay(item.drama, item.episode)"
        />
      </view>
      <view v-else class="empty-state">
        <view class="empty-title">还没有追剧</view>
        <view class="empty-desc">在播放页或推荐页点击追剧后，会出现在这里。</view>
        <button class="primary-btn" @tap="goHome">去首页</button>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
  import { ref } from 'vue';
  import { onShow } from '@dcloudio/uni-app';
  import DramaCard from '@/pages/drama/components/DramaCard.vue';
  import { getFollowList, saveHistory } from '@/pages/drama/data';

  const list = ref([]);

  function refresh() {
    list.value = getFollowList();
  }

  function goBack() {
    uni.navigateBack();
  }

  function goHome() {
    uni.switchTab({
      url: '/pages/index/index',
    });
  }

  function goPlay(drama, episode = 1) {
    saveHistory(drama.id, episode);
    uni.navigateTo({
      url: `/pages/drama/play?id=${encodeURIComponent(drama.id)}&episode=${episode}`,
    });
  }

  onShow(refresh);
</script>

<style lang="scss" scoped>
  .follow-page {
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

  .drama-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28rpx 18rpx;
    padding: 24rpx;
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
    line-height: 38rpx;
  }

  .primary-btn {
    height: 72rpx;
    margin-top: 28rpx;
    padding: 0 38rpx;
    border: 0;
    border-radius: 38rpx;
    background: #ff5a1f;
    color: #fff;
    font-size: 28rpx;
    font-weight: 800;
    line-height: 72rpx;
  }
</style>
