<template>
  <view class="drama-tabbar">
    <view
      v-for="item in tabs"
      :key="item.key"
      class="tabbar-item"
      :class="{ active: active === item.key }"
      @tap="go(item)"
    >
      <uni-icons
        :type="active === item.key ? item.activeIcon : item.icon"
        size="24"
        :color="active === item.key ? '#ff5a1f' : '#8a8a8a'"
      />
      <text>{{ item.text }}</text>
    </view>
  </view>
</template>

<script setup>
  defineProps({
    active: {
      type: String,
      default: 'home',
    },
  });

  const tabs = [
    {
      key: 'home',
      text: '首页',
      path: '/pages/index/index',
      icon: 'home',
      activeIcon: 'home-filled',
    },
    {
      key: 'theater',
      text: '剧场',
      path: '/pages/index/category',
      icon: 'videocam',
      activeIcon: 'videocam-filled',
    },
    {
      key: 'my',
      text: '我的',
      path: '/pages/index/user',
      icon: 'person',
      activeIcon: 'person-filled',
    },
  ];

  function go(item) {
    uni.switchTab({
      url: item.path,
    });
  }
</script>

<style lang="scss" scoped>
  .drama-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-around;
    height: calc(104rpx + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: rgba(255, 255, 255, 0.96);
    border-top: 1rpx solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 -8rpx 24rpx rgba(0, 0, 0, 0.05);
  }

  .tabbar-item {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 104rpx;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    color: #8a8a8a;
    font-size: 22rpx;
    line-height: 28rpx;
  }

  .tabbar-item text {
    margin-top: 6rpx;
  }

  .tabbar-item.active {
    color: #ff5a1f;
    font-weight: 600;
  }
</style>
