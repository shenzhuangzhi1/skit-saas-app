<template>
  <view class="about-page">
    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="23" color="#222" />
      </view>
      <view class="title">关于</view>
    </view>

    <view class="logo-card">
      <view class="logo">短</view>
      <view class="app-name">短剧 SaaS</view>
      <view class="app-desc">精彩短剧尽在短剧 SaaS</view>
      <view v-if="appVersion" class="version">v{{ appVersion }}</view>
    </view>
  </view>
</template>

<script setup>
  import { ref } from 'vue';
  import { onLoad } from '@dcloudio/uni-app';

  const appVersion = ref('');

  function goBack() {
    uni.navigateBack();
  }

  onLoad(() => {
    if (typeof uni.getAppBaseInfo !== 'function') {
      return;
    }
    const appInfo = uni.getAppBaseInfo() || {};
    appVersion.value = String(appInfo.appVersion || appInfo.version || '').trim();
  });
</script>

<style lang="scss" scoped>
  .about-page {
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
    font-size: 34rpx;
    font-weight: 800;
  }

  .logo-card {
    display: flex;
    align-items: center;
    flex-direction: column;
    margin: 40rpx 24rpx 0;
    padding: 58rpx 34rpx;
    border-radius: 20rpx;
    background: #fff;
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 112rpx;
    height: 112rpx;
    border-radius: 28rpx;
    background: #ff5a1f;
    color: #fff;
    font-size: 56rpx;
    font-weight: 900;
  }

  .app-name {
    margin-top: 26rpx;
    font-size: 38rpx;
    font-weight: 900;
  }

  .app-desc,
  .version {
    margin-top: 14rpx;
    color: #888;
    font-size: 26rpx;
  }

  .version {
    margin-top: 8rpx;
  }

</style>
