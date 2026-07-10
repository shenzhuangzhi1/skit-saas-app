<template>
  <view class="my-page">
    <scroll-view scroll-y class="page-scroll">
      <view class="profile">
        <view class="avatar">
          <uni-icons type="person-filled" size="34" color="#fff" />
        </view>
        <view class="profile-copy">
          <view class="name">点击登录</view>
          <view class="id">ID：SKIT-{{ visitorId }}</view>
        </view>
      </view>

      <view class="stats">
        <view class="stat-item">
          <view class="stat-value">{{ followList.length }}</view>
          <view class="stat-label">追剧</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ historyList.length }}</view>
          <view class="stat-label">观看</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">VIP</view>
          <view class="stat-label">权益</view>
        </view>
      </view>

      <view v-if="followList.length > 0" class="panel">
        <view class="panel-head">
          <view class="panel-title">我的追剧</view>
          <view class="panel-more" @tap="goFollow">查看全部</view>
        </view>
        <scroll-view scroll-x class="horizontal-scroll" :show-scrollbar="false">
          <view class="horizontal-list">
            <DramaCard
              v-for="item in followList"
              :key="item.id"
              mode="compact"
              :drama="item.drama"
              :episode="item.episode"
              @select="goPlay(item.drama, item.episode)"
            />
          </view>
        </scroll-view>
      </view>

      <view class="panel menu-panel">
        <view class="menu-item" @tap="goFollow">
          <view class="menu-left">
            <uni-icons type="heart-filled" size="21" color="#ff5a1f" />
            <text>我的追剧</text>
          </view>
          <uni-icons type="right" size="18" color="#b0b0b0" />
        </view>
        <view class="menu-item" @tap="goVip">
          <view class="menu-left">
            <uni-icons type="star-filled" size="21" color="#ffb423" />
            <text>VIP 权益</text>
          </view>
          <uni-icons type="right" size="18" color="#b0b0b0" />
        </view>
        <view class="menu-item" @tap="goAbout">
          <view class="menu-left">
            <uni-icons type="info-filled" size="21" color="#3d8bff" />
            <text>关于短剧 SaaS</text>
          </view>
          <uni-icons type="right" size="18" color="#b0b0b0" />
        </view>
      </view>

      <view class="panel service-card">
        <view class="service-title">内容能力</view>
        <view class="service-desc">
          推荐短剧、剧场分类、播放选集、看广告解锁、追剧与观看历史已按参考项目完成前端闭环。
        </view>
      </view>
    </scroll-view>

    <DramaTabbar active="my" />
  </view>
</template>

<script setup>
  import { ref } from 'vue';
  import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
  import DramaCard from '@/pages/drama/components/DramaCard.vue';
  import DramaTabbar from '@/pages/drama/components/DramaTabbar.vue';
  import { getFollowList, getHistoryList, saveHistory } from '@/pages/drama/data';

  uni.hideTabBar({
    fail: () => {},
  });

  const followList = ref([]);
  const historyList = ref([]);
  const visitorId = String(Math.floor(Math.random() * 900000 + 100000));

  function refresh() {
    followList.value = getFollowList();
    historyList.value = getHistoryList();
  }

  function goPlay(drama, episode = 1) {
    saveHistory(drama.id, episode);
    uni.navigateTo({
      url: `/pages/drama/play?id=${encodeURIComponent(drama.id)}&episode=${episode}`,
    });
  }

  function goFollow() {
    uni.navigateTo({
      url: '/pages/drama/follow',
    });
  }

  function goVip() {
    uni.navigateTo({
      url: '/pages/drama/vip',
    });
  }

  function goAbout() {
    uni.navigateTo({
      url: '/pages/drama/about',
    });
  }

  onShow(refresh);

  onPullDownRefresh(() => {
    refresh();
    setTimeout(() => uni.stopPullDownRefresh(), 300);
  });
</script>

<style lang="scss" scoped>
  .my-page {
    min-height: 100vh;
    background: #f4f4f4;
    color: #202020;
  }

  .page-scroll {
    height: 100vh;
  }

  .profile {
    display: flex;
    align-items: center;
    padding: 100rpx 34rpx 74rpx;
    background: linear-gradient(160deg, #ff6a22 0%, #ff4a1a 48%, #231817 100%);
    color: #fff;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 112rpx;
    height: 112rpx;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: 2rpx solid rgba(255, 255, 255, 0.42);
  }

  .profile-copy {
    margin-left: 22rpx;
  }

  .name {
    font-size: 36rpx;
    font-weight: 800;
  }

  .id {
    margin-top: 8rpx;
    color: rgba(255, 255, 255, 0.76);
    font-size: 24rpx;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16rpx;
    margin: -44rpx 24rpx 0;
    padding: 26rpx 0;
    border-radius: 18rpx;
    background: #fff;
    box-shadow: 0 16rpx 40rpx rgba(33, 20, 14, 0.12);
  }

  .stat-item {
    text-align: center;
  }

  .stat-value {
    color: #1d1d1d;
    font-size: 34rpx;
    font-weight: 800;
  }

  .stat-label {
    margin-top: 6rpx;
    color: #8d8d8d;
    font-size: 24rpx;
  }

  .panel {
    margin: 22rpx 24rpx 0;
    padding: 24rpx;
    border-radius: 18rpx;
    background: #fff;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18rpx;
  }

  .panel-title {
    color: #191919;
    font-size: 32rpx;
    font-weight: 800;
  }

  .panel-more {
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

  .menu-panel {
    padding: 0 24rpx;
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 96rpx;
    border-bottom: 1rpx solid #f0f0f0;
  }

  .menu-item:last-child {
    border-bottom: 0;
  }

  .menu-left {
    display: flex;
    align-items: center;
    color: #222;
    font-size: 30rpx;
    font-weight: 600;
  }

  .menu-left text {
    margin-left: 14rpx;
  }

  .service-card {
    margin-bottom: 156rpx;
  }

  .service-title {
    color: #191919;
    font-size: 30rpx;
    font-weight: 800;
  }

  .service-desc {
    margin-top: 12rpx;
    color: #777;
    font-size: 26rpx;
    line-height: 40rpx;
  }
</style>
