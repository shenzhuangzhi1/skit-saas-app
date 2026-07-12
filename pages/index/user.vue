<template>
  <view class="my-page">
    <scroll-view scroll-y class="page-scroll">
      <view class="profile" @tap="handleProfileTap">
        <view class="avatar">
          <image v-if="userInfo.avatar" :src="userInfo.avatar" mode="aspectFill" />
          <uni-icons v-else type="person-filled" size="34" color="#fff" />
        </view>
        <view class="profile-copy">
          <view class="name">{{ isLogin ? displayName : '点击登录' }}</view>
          <view class="id">
            {{ isLogin ? `用户 ID：${displayUserId}` : '登录后同步邀请关系与收益身份' }}
          </view>
        </view>
        <view v-if="!isLogin" class="profile-action">登录 / 注册</view>
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
          <view class="stat-value">{{ isLogin ? '已登录' : '游客' }}</view>
          <view class="stat-label">账号状态</view>
        </view>
      </view>

      <view v-if="isLogin" class="panel account-panel">
        <view class="panel-title">代理商身份</view>
        <view class="account-row">
          <view class="account-label">所属代理商</view>
          <view class="account-value">{{ agencyName }}</view>
        </view>
        <view class="account-row invite-row" @tap="copyInviteCode">
          <view>
            <view class="account-label">我的邀请码</view>
            <view class="invite-code">{{ inviteCode || '暂未生成' }}</view>
          </view>
          <view v-if="inviteCode" class="copy-action">复制</view>
        </view>
      </view>

      <view v-else class="panel guest-card">
        <view class="guest-title">登录后加入邀请体系</view>
        <view class="guest-copy">新用户需要使用代理商或上级用户的邀请码注册。</view>
        <view class="guest-actions">
          <button class="guest-button primary" @tap="goAuth('login')">登录</button>
          <button class="guest-button" @tap="goAuth('register')">邀请码注册</button>
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
        <view v-if="isLogin" class="menu-item" @tap="goTeam">
          <view class="menu-left">
            <uni-icons type="staff-filled" size="21" color="#7b61ff" />
            <text>我的团队</text>
          </view>
          <uni-icons type="right" size="18" color="#b0b0b0" />
        </view>
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

      <button v-if="isLogin" class="logout-button" @tap="confirmLogout">退出登录</button>
    </scroll-view>

    <DramaTabbar active="my" />
  </view>
</template>

<script setup>
  import { computed, ref } from 'vue';
  import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
  import sheep from '@/sheep';
  import DramaCard from '@/pages/drama/components/DramaCard.vue';
  import DramaTabbar from '@/pages/drama/components/DramaTabbar.vue';
  import { getFollowList, getHistoryList, saveHistory } from '@/pages/drama/data';
  import { openDirectDramaPlayer } from '@/pages/drama/services/pangle-content';

  uni.hideTabBar({
    fail: () => {},
  });

  const followList = ref([]);
  const historyList = ref([]);
  const userStore = sheep.$store('user');
  const isLogin = computed(() => userStore.isLogin);
  const userInfo = computed(() => userStore.userInfo || {});
  const displayName = computed(
    () => userInfo.value.nickname || userInfo.value.mobile || '短剧用户',
  );
  const displayUserId = computed(() => userInfo.value.userId || userInfo.value.id || '-');
  const inviteCode = computed(() => userInfo.value.inviteCode || '');
  const agencyName = computed(() => {
    const profile = userInfo.value;
    const config = userStore.adConfig || {};
    return (
      profile.agentName ||
      profile.agencyName ||
      profile.dealerName ||
      profile.tenantName ||
      profile.agent?.name ||
      profile.tenant?.name ||
      config.agentName ||
      config.agencyName ||
      config.dealerName ||
      config.tenantName ||
      config.name ||
      (profile.tenantCode && `代理商 ${profile.tenantCode}`) ||
      (config.tenantCode && `代理商 ${config.tenantCode}`) ||
      (profile.tenantId ? `租户 ${profile.tenantId}` : '当前代理商')
    );
  });

  async function refresh(forceUser = false) {
    followList.value = getFollowList();
    historyList.value = getHistoryList();
    if (userStore.isLogin) {
      await userStore.updateUserData(forceUser);
    }
  }

  function handleProfileTap() {
    if (!userStore.isLogin) {
      goAuth('login');
    }
  }

  function goAuth(mode) {
    uni.navigateTo({
      url: `/pages/auth/index?mode=${mode}`,
    });
  }

  function goTeam() {
    if (!userStore.isLogin) {
      goAuth('login');
      return;
    }
    uni.navigateTo({
      url: '/pages/auth/team',
    });
  }

  function copyInviteCode() {
    if (!inviteCode.value) {
      return;
    }
    uni.setClipboardData({
      data: inviteCode.value,
      success: () => {
        uni.showToast({ title: '邀请码已复制', icon: 'none' });
      },
    });
  }

  function confirmLogout() {
    uni.showModal({
      title: '退出登录',
      content: '确认退出当前账号吗？',
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }
        await userStore.logout();
        await refresh();
        uni.showToast({ title: '已退出登录', icon: 'none' });
      },
    });
  }

  function goPlay(drama, episode = 1) {
    saveHistory(drama.id, episode);
    openDirectDramaPlayer(drama, episode, 'profile_direct');
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

  onShow(() => refresh());

  onPullDownRefresh(async () => {
    await refresh(true);
    uni.stopPullDownRefresh();
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

  .avatar image {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }

  .profile-copy {
    flex: 1;
    min-width: 0;
    margin-left: 22rpx;
  }

  .profile-action {
    padding: 12rpx 18rpx;
    border: 1rpx solid rgba(255, 255, 255, 0.42);
    border-radius: 28rpx;
    color: #fff;
    font-size: 23rpx;
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

  .account-panel {
    padding-bottom: 10rpx;
  }

  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 88rpx;
    border-bottom: 1rpx solid #f1f1f1;
  }

  .account-row:last-child {
    border-bottom: 0;
  }

  .account-label {
    color: #777;
    font-size: 25rpx;
  }

  .account-value {
    max-width: 390rpx;
    overflow: hidden;
    color: #222;
    font-size: 27rpx;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invite-code {
    margin-top: 6rpx;
    color: #ff5a1f;
    font-size: 34rpx;
    font-weight: 800;
    letter-spacing: 2rpx;
  }

  .copy-action {
    padding: 10rpx 20rpx;
    border-radius: 24rpx;
    background: #fff0e9;
    color: #ff5a1f;
    font-size: 24rpx;
  }

  .guest-title {
    color: #222;
    font-size: 30rpx;
    font-weight: 800;
  }

  .guest-copy {
    margin-top: 10rpx;
    color: #888;
    font-size: 24rpx;
    line-height: 38rpx;
  }

  .guest-actions {
    display: flex;
    margin-top: 22rpx;
  }

  .guest-button {
    flex: 1;
    height: 72rpx;
    margin: 0 0 0 14rpx;
    border: 0;
    border-radius: 36rpx;
    background: #fff0e9;
    color: #ff5a1f;
    font-size: 26rpx;
    line-height: 72rpx;
  }

  .guest-button:first-child {
    margin-left: 0;
  }

  .guest-button.primary {
    background: #ff5a1f;
    color: #fff;
  }

  .guest-button::after,
  .logout-button::after {
    border: 0;
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
    margin-bottom: 22rpx;
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

  .logout-button {
    height: 82rpx;
    margin: 0 24rpx 156rpx;
    border: 0;
    border-radius: 18rpx;
    background: #fff;
    color: #e34d59;
    font-size: 28rpx;
    line-height: 82rpx;
  }
</style>
