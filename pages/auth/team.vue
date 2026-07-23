<template>
  <s-layout title="我的团队">
    <view class="team-page">
      <view class="summary-card">
        <view class="summary-label">直属成员</view>
        <view class="summary-value">{{ state.total }}</view>
        <view class="summary-tip">成员也可以继续使用自己的邀请码发展下级</view>
      </view>

      <view class="member-list">
        <view v-for="item in state.list" :key="item.id || item.userId" class="member-card">
          <view class="member-avatar">
            <image v-if="item.avatar" :src="item.avatar" mode="aspectFill" />
            <uni-icons v-else type="person-filled" size="24" color="#ff5a1f" />
          </view>
          <view class="member-main">
            <view class="member-name">{{ item.nickname || item.mobile || '未命名用户' }}</view>
            <view class="member-meta">
              {{ item.mobile || `用户 ID：${item.userId || item.id || '-'}` }}
            </view>
            <view v-if="item.inviteCode" class="member-code">邀请码：{{ item.inviteCode }}</view>
          </view>
          <view v-if="item.childCount !== undefined" class="child-count">
            {{ item.childCount }} 位下级
          </view>
        </view>

        <view v-if="!state.loading && state.list.length === 0" class="empty-state">
          <view class="empty-title">还没有直属成员</view>
          <view class="empty-copy">分享个人邀请码，邀请新用户加入你的团队。</view>
        </view>

        <view v-if="state.loading" class="load-state">加载中...</view>
        <view v-else-if="state.list.length >= state.total && state.total > 0" class="load-state">
          已加载全部成员
        </view>
      </view>
    </view>
  </s-layout>
</template>

<script setup>
  import { reactive } from 'vue';
  import { onLoad, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
  import sheep from '@/sheep';
  import InvitationApi from '@/sheep/api/member/invitation';
  import { showAuthPage } from '@/sheep/hooks/useModal';

  const state = reactive({
    pageNo: 1,
    pageSize: 20,
    total: 0,
    list: [],
    loading: false,
  });

  async function loadChildren(reset = false) {
    if (state.loading) {
      return;
    }
    if (!reset && state.total > 0 && state.list.length >= state.total) {
      return;
    }
    if (reset) {
      state.pageNo = 1;
      state.total = 0;
      state.list = [];
    }

    state.loading = true;
    try {
      const result = await InvitationApi.getChildren({
        pageNo: state.pageNo,
        pageSize: state.pageSize,
      });
      if (result?.code !== 0) {
        return;
      }
      const data = result.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      state.list = reset ? list : state.list.concat(list);
      state.total = Number(data.total ?? state.list.length);
      if (state.list.length < state.total && list.length > 0) {
        state.pageNo += 1;
      }
    } finally {
      state.loading = false;
    }
  }

  onLoad(() => {
    if (!sheep.$store('user').isLogin) {
      showAuthPage('login');
      return;
    }
    loadChildren(true);
  });

  onPullDownRefresh(async () => {
    await loadChildren(true);
    uni.stopPullDownRefresh();
  });

  onReachBottom(() => loadChildren());
</script>

<style lang="scss" scoped>
  .team-page {
    min-height: 100vh;
    padding: 24rpx 24rpx 60rpx;
    background: #f5f5f5;
  }

  .summary-card {
    padding: 36rpx;
    border-radius: 24rpx;
    background: linear-gradient(145deg, #ff6a22, #ff461a 58%, #2a1c1a);
    color: #fff;
    box-shadow: 0 16rpx 36rpx rgba(255, 80, 27, 0.2);
  }

  .summary-label {
    color: rgba(255, 255, 255, 0.78);
    font-size: 25rpx;
  }

  .summary-value {
    margin-top: 8rpx;
    font-size: 62rpx;
    font-weight: 800;
  }

  .summary-tip {
    margin-top: 16rpx;
    color: rgba(255, 255, 255, 0.72);
    font-size: 23rpx;
  }

  .member-list {
    margin-top: 22rpx;
  }

  .member-card {
    display: flex;
    align-items: center;
    margin-bottom: 16rpx;
    padding: 24rpx;
    border-radius: 18rpx;
    background: #fff;
  }

  .member-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 84rpx;
    height: 84rpx;
    overflow: hidden;
    border-radius: 50%;
    background: #fff0e8;
  }

  .member-avatar image {
    width: 100%;
    height: 100%;
  }

  .member-main {
    flex: 1;
    min-width: 0;
    margin-left: 20rpx;
  }

  .member-name {
    overflow: hidden;
    color: #222;
    font-size: 29rpx;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-meta,
  .member-code {
    margin-top: 6rpx;
    color: #999;
    font-size: 23rpx;
  }

  .child-count {
    margin-left: 16rpx;
    color: #ff5a1f;
    font-size: 23rpx;
  }

  .empty-state {
    padding: 110rpx 36rpx;
    text-align: center;
  }

  .empty-title {
    color: #333;
    font-size: 30rpx;
    font-weight: 700;
  }

  .empty-copy,
  .load-state {
    margin-top: 14rpx;
    color: #999;
    font-size: 24rpx;
    text-align: center;
  }

  .load-state {
    padding: 26rpx 0;
  }
</style>
