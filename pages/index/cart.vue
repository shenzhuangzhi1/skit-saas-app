<template>
  <view class="follow-proxy">
    <view class="loading">正在打开我的追剧</view>
  </view>
</template>

<script setup>
  import { onLoad } from '@dcloudio/uni-app';

  onLoad(() => {
    uni.redirectTo({
      url: '/pages/drama/follow',
    });
  });
</script>

<style lang="scss" scoped>
  .follow-proxy {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f6f6f6;
    color: #777;
    font-size: 28rpx;
  }
</style>
