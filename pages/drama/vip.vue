<template>
  <view class="vip-page">
    <view class="header">
      <view class="back" @tap="goBack">
        <uni-icons type="back" size="23" color="#fff" />
      </view>
      <view class="title">VIP 权益</view>
    </view>

    <view class="hero">
      <view class="vip-badge">
        <uni-icons type="vip-filled" size="30" color="#2b1b12" />
      </view>
      <view class="hero-title">短剧会员中心</view>
      <view class="hero-desc">会员定价、支付和免广告策略后续接入真实后端。</view>
    </view>

    <view class="benefits">
      <view v-for="item in benefits" :key="item.title" class="benefit-item">
        <view class="benefit-icon">
          <uni-icons :type="item.icon" size="22" color="#ff5a1f" />
        </view>
        <view>
          <view class="benefit-title">{{ item.title }}</view>
          <view class="benefit-desc">{{ item.desc }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
  const benefits = [
    { title: '免广告解锁', desc: '可作为看广告解锁之外的付费路径。', icon: 'locked-filled' },
    { title: '提前看', desc: '连载剧可配置 VIP 提前观看集数。', icon: 'calendar-filled' },
    { title: '高清播放', desc: '播放 SDK 接入后可配置清晰度权益。', icon: 'videocam-filled' },
  ];

  function goBack() {
    uni.navigateBack();
  }
</script>

<style lang="scss" scoped>
  .vip-page {
    min-height: 100vh;
    background: #17110d;
    color: #fff;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 88rpx 24rpx 22rpx;
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64rpx;
    height: 64rpx;
    margin-right: 18rpx;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
  }

  .title {
    font-size: 34rpx;
    font-weight: 800;
  }

  .hero {
    margin: 20rpx 24rpx 0;
    padding: 52rpx 34rpx;
    border-radius: 22rpx;
    background: linear-gradient(150deg, #ffe2a4 0%, #d79944 54%, #6b3f18 100%);
    color: #2b1b12;
  }

  .vip-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.38);
  }

  .hero-title {
    margin-top: 28rpx;
    font-size: 44rpx;
    font-weight: 900;
  }

  .hero-desc {
    margin-top: 12rpx;
    font-size: 27rpx;
    line-height: 40rpx;
  }

  .benefits {
    margin: 24rpx;
    padding: 6rpx 24rpx;
    border-radius: 18rpx;
    background: #fff;
    color: #202020;
  }

  .benefit-item {
    display: flex;
    align-items: center;
    padding: 26rpx 0;
    border-bottom: 1rpx solid #f0f0f0;
  }

  .benefit-item:last-child {
    border-bottom: 0;
  }

  .benefit-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
    margin-right: 18rpx;
    border-radius: 50%;
    background: #fff3ed;
  }

  .benefit-title {
    font-size: 30rpx;
    font-weight: 800;
  }

  .benefit-desc {
    margin-top: 8rpx;
    color: #777;
    font-size: 25rpx;
    line-height: 36rpx;
  }
</style>
