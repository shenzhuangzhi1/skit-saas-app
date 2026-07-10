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
      <view class="version">v2026.06</view>
    </view>

    <view class="info-panel">
      <view class="info-row">用户协议</view>
      <view class="info-row">隐私政策</view>
      <view class="info-row">收集个人信息明示清单</view>
      <view class="info-row">个人信息第三方共享清单</view>
    </view>
  </view>
</template>

<script setup>
  function goBack() {
    uni.navigateBack();
  }
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

  .info-panel {
    margin: 24rpx;
    padding: 0 24rpx;
    border-radius: 18rpx;
    background: #fff;
  }

  .info-row {
    min-height: 92rpx;
    border-bottom: 1rpx solid #f0f0f0;
    color: #2989e3;
    font-size: 28rpx;
    line-height: 92rpx;
  }

  .info-row:last-child {
    border-bottom: 0;
  }
</style>
