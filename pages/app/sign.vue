<template>
  <s-layout title="签到打卡" navbar="normal" navbarBackgroundColor="#ffffff">
    <view class="sign-page">
      <view v-if="state.loading" class="state-card">
        <uni-icons type="spinner-cycle" size="30" color="#ff5a1f" />
        <view class="state-title">正在同步签到状态</view>
        <view class="state-desc">签到结果和积分以当前账号的服务端记录为准</view>
      </view>

      <view v-else-if="state.error" class="state-card error-card">
        <uni-icons type="info-filled" size="30" color="#ff5a1f" />
        <view class="state-title">签到状态加载失败</view>
        <view class="state-desc">{{ state.error }}</view>
        <button class="retry-btn" @tap="retrySignInfo">重新加载</button>
      </view>

      <template v-else-if="state.ready">
        <view class="hero-card">
          <view class="hero-kicker">每日签到 · 每次固定 +1 积分</view>
          <view class="streak-row">
            <view>
              <view class="streak-value">{{ state.signInfo.continuousDay }}</view>
              <view class="streak-label">连续签到天数</view>
            </view>
            <view class="today-badge" :class="{ completed: state.signInfo.todaySignIn }">
              {{ state.signInfo.todaySignIn ? '今日已签到' : '今日待签到' }}
            </view>
          </view>

          <view class="summary-grid">
            <view class="summary-item">
              <view class="summary-value">{{ state.signInfo.totalDay }}</view>
              <view class="summary-label">累计签到</view>
            </view>
            <view class="summary-divider"></view>
            <view class="summary-item">
              <view class="summary-value">{{ state.signInfo.pointBalance }}</view>
              <view class="summary-label">当前积分</view>
            </view>
            <view class="summary-divider"></view>
            <view class="summary-item">
              <view class="summary-value">+1</view>
              <view class="summary-label">本次奖励</view>
            </view>
          </view>
        </view>

        <view class="action-card">
          <view class="action-copy">
            <view class="action-title">
              {{ state.signInfo.todaySignIn ? '今天的签到已完成' : '完成今日签到' }}
            </view>
            <view class="action-desc">
              {{
                state.signInfo.todaySignIn
                  ? '积分已经计入当前账号，可在积分记录中核对。'
                  : '每个账号每天仅可签到一次，成功后立即获得 1 积分。'
              }}
            </view>
          </view>
          <button
            class="sign-btn"
            :class="{ completed: state.signInfo.todaySignIn }"
            :disabled="state.signing || !state.ready || state.signInfo.todaySignIn"
            @tap="onSign"
          >
            {{
              state.signing
                ? '签到中...'
                : state.signInfo.todaySignIn
                ? '今日已签到'
                : '签到并领取 1 积分'
            }}
          </button>
          <button class="record-link" @tap="goPointRecords">
            <text>查看积分记录</text>
            <uni-icons type="right" size="16" color="#ff5a1f" />
          </button>
        </view>

        <view class="rules-card">
          <view class="rules-title">签到说明</view>
          <view class="rule-row">
            <view class="rule-index">1</view>
            <view>每个账号按北京时间每天可签到一次。</view>
          </view>
          <view class="rule-row">
            <view class="rule-index">2</view>
            <view>每次签到固定获得 1 积分，不在前端预先记账。</view>
          </view>
          <view class="rule-row">
            <view class="rule-index">3</view>
            <view>积分余额和每笔流水仅当前登录账号可以查看。</view>
          </view>
        </view>
      </template>
    </view>

    <su-popup :show="state.showModel" type="center" round="18" :isMaskClick="false">
      <view class="success-modal">
        <view class="success-icon">
          <uni-icons type="checkmarkempty" size="34" color="#ffffff" />
        </view>
        <view class="success-title">签到成功</view>
        <view class="success-points">+{{ state.signResult.awardedPoints }} 积分</view>
        <view class="success-desc">
          已连续签到 {{ state.signResult.continuousDay }} 天，当前积分
          {{ state.signResult.pointBalance }}
        </view>
        <button class="confirm-btn" @tap="onConfirm">返回首页看短剧</button>
        <button class="modal-record-link" @tap="goPointRecords">查看积分记录</button>
      </view>
    </su-popup>
  </s-layout>
</template>

<script setup>
  import { onHide, onReady, onShow, onUnload } from '@dcloudio/uni-app';
  import { reactive, watch } from 'vue';
  import sheep from '@/sheep';
  import SignInApi from '@/sheep/api/member/signin';
  import {
    createPageVisitGuard,
    displayAdFlow,
    resolveDisplayPlacements,
  } from '@/pages/drama/services/display-ad-flow.mjs';

  const state = reactive({
    loading: true,
    ready: false,
    error: '',
    signing: false,
    signInfo: null,
    showModel: false,
    signResult: {},
  });
  const userStore = sheep.$store('user');
  const signPageVisitGuard = createPageVisitGuard();
  let pageReady = false;
  let entryAdRequested = false;
  let summaryRequestEpoch = 0;

  function captureCurrentAuthSession() {
    const authSession = userStore.getAuthSessionSnapshot();
    return userStore.isAuthSessionCurrent(authSession) ? authSession : null;
  }

  function isCurrentAuthSession(authSession) {
    return Boolean(authSession) && userStore.isAuthSessionCurrent(authSession);
  }

  function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error(`${label}数据无效`);
    }
    return number;
  }

  function normalizeSignInfo(data) {
    if (typeof data?.todaySignIn !== 'boolean') {
      throw new Error('今日签到状态无效');
    }
    return Object.freeze({
      todaySignIn: data.todaySignIn,
      continuousDay: requireNonNegativeInteger(data.continuousDay, '连续签到'),
      totalDay: requireNonNegativeInteger(data.totalDay, '累计签到'),
      pointBalance: requireNonNegativeInteger(data.pointBalance, '积分余额'),
    });
  }

  function normalizeSignResult(data) {
    const signInDate = String(data?.signInDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signInDate)) {
      throw new Error('签到日期无效');
    }
    const awardedPoints = requireNonNegativeInteger(data.awardedPoints, '签到奖励');
    if (awardedPoints !== 1) {
      throw new Error('签到奖励与固定 1 积分规则不一致');
    }
    return Object.freeze({
      signInDate,
      awardedPoints,
      pointBalance: requireNonNegativeInteger(data.pointBalance, '积分余额'),
      continuousDay: requireNonNegativeInteger(data.continuousDay, '连续签到'),
      totalDay: requireNonNegativeInteger(data.totalDay, '累计签到'),
    });
  }

  async function getSignInfo(options = {}) {
    const authSession = options.authSession || captureCurrentAuthSession();
    const requestEpoch = ++summaryRequestEpoch;
    if (options.showLoading !== false) {
      state.loading = true;
    }
    state.error = '';
    if (!authSession) {
      state.signInfo = null;
      state.ready = false;
      state.loading = false;
      state.error = '登录状态已更新，请重新进入签到页面';
      return false;
    }
    try {
      const { code, data } = await SignInApi.getSignInRecordSummary();
      if (code !== 0) {
        throw new Error('服务端未返回可用的签到状态');
      }
      const signInfo = normalizeSignInfo(data);
      if (requestEpoch !== summaryRequestEpoch || !isCurrentAuthSession(authSession)) {
        return false;
      }
      state.signInfo = signInfo;
      state.ready = true;
      return true;
    } catch (error) {
      if (requestEpoch !== summaryRequestEpoch || !isCurrentAuthSession(authSession)) {
        return false;
      }
      state.signInfo = null;
      state.ready = false;
      state.error = error?.message || '请检查网络后重试';
      return false;
    } finally {
      if (requestEpoch === summaryRequestEpoch && isCurrentAuthSession(authSession)) {
        state.loading = false;
      }
    }
  }

  function retrySignInfo() {
    void getSignInfo();
  }

  async function onSign() {
    if (state.signing || !state.ready || !state.signInfo || state.signInfo.todaySignIn) {
      return;
    }
    const authSession = captureCurrentAuthSession();
    if (!authSession) {
      state.ready = false;
      state.error = '登录状态已更新，请重新进入签到页面';
      return;
    }
    state.signing = true;
    try {
      const { code, data } = await SignInApi.createSignInRecord();
      if (!isCurrentAuthSession(authSession)) {
        return;
      }
      if (code !== 0) {
        throw new Error('签到提交失败，请稍后重试');
      }
      const result = normalizeSignResult(data);
      state.signResult = result;
      state.signInfo = Object.freeze({
        todaySignIn: true,
        continuousDay: result.continuousDay,
        totalDay: result.totalDay,
        pointBalance: result.pointBalance,
      });
      state.showModel = true;
      const markerStored = markPostCheckIn(result.signInDate, authSession);
      const refreshResults = await Promise.allSettled([
        getSignInfo({ showLoading: false, authSession }),
        userStore.updateUserData(true),
      ]);
      if (!isCurrentAuthSession(authSession)) {
        state.showModel = false;
        return;
      }
      if (!markerStored) {
        markPostCheckIn(result.signInDate, authSession);
      }
      if (refreshResults.some((item) => item.status === 'rejected')) {
        console.warn('[check-in] post-sign-in refresh incomplete');
      }
    } catch (error) {
      if (!isCurrentAuthSession(authSession)) {
        return;
      }
      console.warn('[check-in] sign-in request failed');
      uni.showToast({
        title: error?.message || '签到失败，请稍后重试',
        icon: 'none',
      });
    } finally {
      state.signing = false;
    }
  }

  function markPostCheckIn(signInDate, authSession) {
    if (!isCurrentAuthSession(authSession)) {
      return false;
    }
    return displayAdFlow.markPostCheckIn({
      tenantId: authSession.tenantId,
      memberId: authSession.memberId,
      signInDate,
    });
  }

  function onConfirm() {
    state.showModel = false;
    uni.switchTab({
      url: '/pages/index/index',
    });
  }

  function goPointRecords() {
    state.showModel = false;
    uni.navigateTo({
      url: '/pages/user/wallet/score',
    });
  }

  async function showCheckInEntryInterstitial(visitEpoch) {
    try {
      try {
        await userStore.getAdConfig();
      } catch (error) {
        console.warn('[display-ad] check-in placement config unavailable');
      }
      if (!signPageVisitGuard.isCurrent(visitEpoch)) {
        return;
      }
      const placements = resolveDisplayPlacements(userStore.adConfig);
      await signPageVisitGuard.runPresentation(visitEpoch, () =>
        displayAdFlow.showCheckInEntryInterstitial(placements.checkInEntryInterstitial),
      );
    } catch (error) {
      if (error?.code !== 'PAGE_VISIT_INVALIDATED') {
        console.warn('[display-ad] check-in interstitial unavailable');
      }
    }
  }

  function scheduleCheckInEntryInterstitial() {
    const visitEpoch = signPageVisitGuard.capture();
    if (!pageReady || entryAdRequested || !signPageVisitGuard.isCurrent(visitEpoch)) {
      return;
    }
    entryAdRequested = true;
    void showCheckInEntryInterstitial(visitEpoch);
  }

  watch(
    () => userStore.authSessionEpoch,
    () => {
      summaryRequestEpoch += 1;
      state.loading = true;
      state.ready = false;
      state.error = '';
      state.signing = false;
      state.showModel = false;
      state.signInfo = null;
      state.signResult = {};
    },
  );

  onShow(() => {
    signPageVisitGuard.enter();
    if (pageReady) {
      void getSignInfo({ showLoading: !state.ready });
    }
    scheduleCheckInEntryInterstitial();
  });

  onHide(() => {
    signPageVisitGuard.leave();
  });

  onUnload(() => {
    signPageVisitGuard.unload();
    summaryRequestEpoch += 1;
  });

  onReady(() => {
    pageReady = true;
    void getSignInfo();
    scheduleCheckInEntryInterstitial();
  });
</script>

<style lang="scss" scoped>
  .sign-page {
    min-height: calc(100vh - 88rpx);
    padding: 24rpx 24rpx 60rpx;
    box-sizing: border-box;
    background: #f6f6f6;
  }

  .state-card,
  .hero-card,
  .action-card,
  .rules-card {
    border-radius: 22rpx;
    background: #ffffff;
    box-shadow: 0 10rpx 30rpx rgba(33, 20, 14, 0.06);
  }

  .state-card {
    display: flex;
    min-height: 420rpx;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 48rpx;
    text-align: center;
  }

  .state-title {
    margin-top: 20rpx;
    color: #202020;
    font-size: 32rpx;
    font-weight: 800;
  }

  .state-desc {
    margin-top: 12rpx;
    color: #888888;
    font-size: 25rpx;
    line-height: 38rpx;
  }

  .retry-btn {
    height: 68rpx;
    margin-top: 28rpx;
    padding: 0 34rpx;
    border: 0;
    border-radius: 34rpx;
    background: #ff5a1f;
    color: #ffffff;
    font-size: 26rpx;
    line-height: 68rpx;
  }

  .hero-card {
    padding: 34rpx;
    overflow: hidden;
    background: linear-gradient(145deg, #ff6325 0%, #ff8a31 58%, #2b1f1b 140%);
    color: #ffffff;
  }

  .hero-kicker {
    color: rgba(255, 255, 255, 0.78);
    font-size: 24rpx;
  }

  .streak-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-top: 24rpx;
  }

  .streak-value {
    font-size: 72rpx;
    font-weight: 900;
    line-height: 82rpx;
  }

  .streak-label {
    color: rgba(255, 255, 255, 0.76);
    font-size: 24rpx;
  }

  .today-badge {
    padding: 12rpx 20rpx;
    border: 1rpx solid rgba(255, 255, 255, 0.36);
    border-radius: 28rpx;
    background: rgba(255, 255, 255, 0.14);
    font-size: 23rpx;
  }

  .today-badge.completed {
    background: rgba(28, 166, 101, 0.9);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1rpx 1fr 1rpx 1fr;
    align-items: center;
    margin-top: 34rpx;
    padding: 24rpx 12rpx;
    border-radius: 18rpx;
    background: rgba(255, 255, 255, 0.12);
  }

  .summary-item {
    text-align: center;
  }

  .summary-divider {
    width: 1rpx;
    height: 54rpx;
    background: rgba(255, 255, 255, 0.2);
  }

  .summary-value {
    font-size: 34rpx;
    font-weight: 800;
  }

  .summary-label {
    margin-top: 5rpx;
    color: rgba(255, 255, 255, 0.7);
    font-size: 22rpx;
  }

  .action-card,
  .rules-card {
    margin-top: 20rpx;
    padding: 30rpx;
  }

  .action-title,
  .rules-title {
    color: #202020;
    font-size: 32rpx;
    font-weight: 800;
  }

  .action-desc {
    margin-top: 10rpx;
    color: #858585;
    font-size: 25rpx;
    line-height: 38rpx;
  }

  .sign-btn {
    width: 100%;
    height: 82rpx;
    margin-top: 28rpx;
    border: 0;
    border-radius: 42rpx;
    background: linear-gradient(90deg, #ff5a1f, #ff8730);
    color: #ffffff;
    font-size: 29rpx;
    font-weight: 800;
    line-height: 82rpx;
    box-shadow: 0 12rpx 26rpx rgba(255, 90, 31, 0.24);
  }

  .sign-btn.completed {
    background: #dedede;
    box-shadow: none;
  }

  .record-link {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64rpx;
    margin-top: 12rpx;
    border: 0;
    background: transparent;
    color: #ff5a1f;
    font-size: 25rpx;
    line-height: 64rpx;
  }

  .record-link text {
    margin-right: 6rpx;
  }

  .rule-row {
    display: flex;
    align-items: flex-start;
    margin-top: 20rpx;
    color: #6f6f6f;
    font-size: 25rpx;
    line-height: 38rpx;
  }

  .rule-index {
    display: flex;
    flex: 0 0 auto;
    width: 36rpx;
    height: 36rpx;
    align-items: center;
    justify-content: center;
    margin-right: 14rpx;
    border-radius: 50%;
    background: #fff0e9;
    color: #ff5a1f;
    font-size: 21rpx;
    font-weight: 800;
  }

  .success-modal {
    width: 560rpx;
    padding: 48rpx 40rpx 34rpx;
    box-sizing: border-box;
    border-radius: 24rpx;
    background: #ffffff;
    text-align: center;
  }

  .success-icon {
    display: flex;
    width: 78rpx;
    height: 78rpx;
    align-items: center;
    justify-content: center;
    margin: 0 auto;
    border-radius: 50%;
    background: linear-gradient(145deg, #ff5a1f, #ff9238);
  }

  .success-title {
    margin-top: 22rpx;
    color: #202020;
    font-size: 36rpx;
    font-weight: 900;
  }

  .success-points {
    margin-top: 12rpx;
    color: #ff5a1f;
    font-size: 44rpx;
    font-weight: 900;
  }

  .success-desc {
    margin-top: 12rpx;
    color: #7b7b7b;
    font-size: 24rpx;
    line-height: 38rpx;
  }

  .confirm-btn {
    width: 100%;
    height: 76rpx;
    margin-top: 30rpx;
    border: 0;
    border-radius: 38rpx;
    background: #ff5a1f;
    color: #ffffff;
    font-size: 27rpx;
    font-weight: 800;
    line-height: 76rpx;
  }

  .modal-record-link {
    height: 62rpx;
    margin-top: 8rpx;
    border: 0;
    background: transparent;
    color: #ff5a1f;
    font-size: 24rpx;
    line-height: 62rpx;
  }

  button::after {
    border: 0;
  }
</style>
