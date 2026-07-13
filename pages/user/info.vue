<template>
  <s-layout title="用户信息" class="member-profile-page">
    <view class="profile-card">
      <image
        class="avatar"
        :src="sheep.$url.static('/static/img/shop/default_avatar.png')"
        mode="aspectFill"
      />
      <view class="member-name">{{ profile.nickname || '短剧用户' }}</view>
      <view class="tenant-name">{{ profile.agentName || profile.tenantName || '所属代理商' }}</view>
    </view>

    <view class="profile-section">
      <uni-list :border="false">
        <uni-list-item title="手机号" :rightText="profile.mobile || '-'" :border="false" />
        <uni-list-item
          title="所属租户"
          :rightText="profile.tenantName || profile.agentName || '-'"
          :border="false"
        />
        <uni-list-item title="层级" :rightText="levelText" :border="false" />
        <uni-list-item
          title="邀请人"
          :rightText="profile.parentNickname || profile.parentName || '代理商直邀'"
          :border="false"
        />
        <uni-list-item
          title="直属用户"
          :rightText="`${profile.directChildren || 0} 人`"
          :border="false"
        />
        <uni-list-item
          title="我的邀请码"
          :rightText="profile.inviteCode || '-'"
          showArrow
          clickable
          :border="false"
          @tap="copyInviteCode"
        />
      </uni-list>
    </view>

    <view class="profile-tip">
      手机号、密码和所属租户均属于登录身份信息。当前 App
      不提供跨租户换绑或通用会员资料修改，需调整时请联系所属代理商。
    </view>
  </s-layout>
</template>

<script setup>
  import { computed, onBeforeMount } from 'vue';
  import sheep from '@/sheep';

  const profile = computed(() => sheep.$store('user').userInfo || {});
  const levelText = computed(() => {
    const level = Number(profile.value.level || profile.value.depth || 0);
    return level > 0 ? `第 ${level} 层` : '代理商直邀';
  });

  function copyInviteCode() {
    if (!profile.value.inviteCode) {
      sheep.$helper.toast('暂无邀请码');
      return;
    }
    sheep.$helper.copyText(profile.value.inviteCode);
  }

  onBeforeMount(() => {
    sheep.$store('user').getInfo();
  });
</script>

<style lang="scss" scoped>
  .member-profile-page {
    background: #f5f5f5;
  }

  .profile-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 64rpx 32rpx 48rpx;
    background: #fff;
  }

  .avatar {
    width: 144rpx;
    height: 144rpx;
    border-radius: 50%;
  }

  .member-name {
    margin-top: 24rpx;
    color: #222;
    font-size: 34rpx;
    font-weight: 600;
  }

  .tenant-name {
    margin-top: 10rpx;
    color: #999;
    font-size: 24rpx;
  }

  .profile-section {
    margin-top: 16rpx;
    background: #fff;
  }

  .profile-tip {
    padding: 28rpx 36rpx;
    color: #999;
    font-size: 24rpx;
    line-height: 1.7;
  }

  :deep(.uni-list-item__content-title),
  :deep(.uni-list-item__extra-text) {
    font-size: 28rpx;
  }
</style>
