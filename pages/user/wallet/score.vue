<template>
  <s-layout title="积分记录" navbar="normal" navbarBackgroundColor="#ffffff">
    <view class="point-page">
      <view class="balance-card">
        <view>
          <view class="balance-label">当前积分</view>
          <view class="balance-value">{{ pointBalanceText }}</view>
        </view>
        <view class="record-total">
          共 {{ state.recordsReady ? state.pagination.total : '--' }} 条
        </view>
      </view>

      <view class="filter-card">
        <uni-datetime-picker
          v-model="state.date"
          type="daterange"
          :end="state.today"
          @change="onChangeTime"
        >
          <button class="date-btn">
            <uni-icons type="calendar" size="17" color="#666666" />
            <text>{{ dateFilterText }}</text>
            <uni-icons type="arrowdown" size="14" color="#999999" />
          </button>
        </uni-datetime-picker>
        <su-tabs
          :list="tabMaps"
          :scrollable="false"
          :current="state.currentTab"
          @change="onChange"
        />
      </view>

      <view v-if="state.initialLoading" class="state-card">
        <uni-icons type="spinner-cycle" size="28" color="#ff5a1f" />
        <view class="state-title">正在加载积分记录</view>
      </view>

      <view v-else-if="state.error && state.pagination.list.length === 0" class="state-card">
        <uni-icons type="info-filled" size="28" color="#ff5a1f" />
        <view class="state-title">积分记录加载失败</view>
        <view class="state-desc">{{ state.error }}</view>
        <button class="retry-btn" @tap="retryPointRecords">重新加载</button>
      </view>

      <view v-else-if="state.pagination.list.length > 0" class="record-list">
        <view class="record-item" v-for="item in state.pagination.list" :key="item.id">
          <view class="record-main">
            <view class="record-title">
              {{ item.title }}{{ item.description ? ` · ${item.description}` : '' }}
            </view>
            <view class="record-time">
              {{ sheep.$helper.timeFormat(item.createTime, 'yyyy-mm-dd hh:MM:ss') }}
            </view>
            <view class="balance-after">变动后余额：{{ item.balanceAfter }}</view>
          </view>
          <view class="delta" :class="{ income: item.pointDelta > 0 }">
            {{ item.pointDelta > 0 ? `+${item.pointDelta}` : item.pointDelta }}
          </view>
        </view>
      </view>

      <view v-else class="state-card empty-card">
        <s-empty text="当前筛选条件下暂无积分记录" icon="/static/data-empty.png" />
      </view>

      <view v-if="state.error && state.pagination.list.length > 0" class="inline-error">
        {{ state.error }}
        <text @tap="retryPointRecords">重试</text>
      </view>

      <uni-load-more
        v-if="state.pagination.list.length > 0"
        :status="state.loadStatus"
        :content-text="{ contentdown: '上拉加载更多' }"
        @tap="onLoadMore"
      />
    </view>
  </s-layout>
</template>

<script setup>
  import { computed, reactive, watch } from 'vue';
  import { onHide, onLoad, onReachBottom, onShow } from '@dcloudio/uni-app';
  import { concat } from 'lodash-es';
  import dayjs from 'dayjs';
  import sheep from '@/sheep';
  import PointApi from '@/sheep/api/member/point';
  import { resetPagination } from '@/sheep/helper/utils';
  import { createPointRecordQueryGate } from './point-record-query.mjs';

  const userStore = sheep.$store('user');
  const userInfo = computed(() => userStore.userInfo || {});
  const pointQueryGate = createPointRecordQueryGate();
  let pageVisible = false;
  const state = reactive({
    currentTab: 0,
    pagination: {
      list: [],
      total: 0,
      pageSize: 10,
      pageNo: 1,
    },
    loadStatus: '',
    initialLoading: true,
    recordsReady: false,
    error: '',
    date: [],
    today: '',
  });

  const tabMaps = [
    { name: '全部', value: 'all' },
    { name: '收入', value: 'true' },
    { name: '支出', value: 'false' },
  ];

  const pointBalanceText = computed(() => {
    const authSession = userStore.getAuthSessionSnapshot();
    const pointBalance = Number(userInfo.value.pointBalance);
    return userStore.isAuthSessionCurrent(authSession) &&
      Number.isSafeInteger(pointBalance) &&
      pointBalance >= 0
      ? pointBalance
      : '--';
  });

  const dateFilterText = computed(() => {
    if (!state.date.length) {
      return '全部日期';
    }
    if (state.date[0] === state.date[1]) {
      return state.date[0];
    }
    return state.date.join(' ~ ');
  });

  function authSessionSignature(authSession) {
    return JSON.stringify({
      epoch: authSession?.epoch,
      tenantId: String(authSession?.tenantId || ''),
      memberId: String(authSession?.memberId || ''),
    });
  }

  function currentFilterSignature(authSession = userStore.getAuthSessionSnapshot()) {
    return JSON.stringify({
      authSession: authSessionSignature(authSession),
      currentTab: state.currentTab,
      date: [...state.date],
    });
  }

  async function getLogList(options = {}) {
    if (state.loadStatus === 'loading' || pointQueryGate.isLoading()) {
      return;
    }
    const authSession = options.authSession || userStore.getAuthSessionSnapshot();
    if (!userStore.isAuthSessionCurrent(authSession)) {
      state.initialLoading = false;
      state.recordsReady = false;
      state.error = '登录状态已更新，请重新进入积分记录';
      return;
    }
    const request = pointQueryGate.tryStart({
      pageNo: state.pagination.pageNo,
      filterSignature: currentFilterSignature(authSession),
      authSession,
    });
    if (!request) {
      return;
    }
    const params = {
      pageNo: request.pageNo,
      pageSize: state.pagination.pageSize,
      addStatus: state.currentTab > 0 ? tabMaps[state.currentTab].value : undefined,
    };
    if (state.date.length === 2) {
      params['createTime[0]'] = `${state.date[0]} 00:00:00`;
      params['createTime[1]'] = `${state.date[1]} 23:59:59`;
    }
    if (request.pageNo === 1) {
      state.error = '';
    }
    state.loadStatus = 'loading';
    try {
      const { code, data } = await PointApi.getPointRecordPage(params);
      if (
        !pointQueryGate.isCurrent(request) ||
        !userStore.isAuthSessionCurrent(request.authSession) ||
        request.filterSignature !== currentFilterSignature(request.authSession) ||
        request.pageNo !== state.pagination.pageNo
      ) {
        return;
      }
      if (code !== 0) {
        throw new Error('服务端未返回可用的积分记录');
      }
      const rows = Array.isArray(data?.list) ? data.list : [];
      state.pagination.list = request.pageNo === 1 ? rows : concat(state.pagination.list, rows);
      state.pagination.total = Number(data?.total) || 0;
      state.loadStatus = state.pagination.list.length < state.pagination.total ? 'more' : 'noMore';
      state.error = '';
      state.recordsReady = true;
    } catch (error) {
      if (
        pointQueryGate.isCurrent(request) &&
        userStore.isAuthSessionCurrent(request.authSession)
      ) {
        if (request.pageNo > 1) {
          state.pagination.pageNo = request.pageNo - 1;
        }
        if (request.pageNo === 1) {
          state.recordsReady = false;
        }
        state.error = error?.message || '请检查网络后重试';
        state.loadStatus = state.pagination.list.length > 0 ? 'more' : 'noMore';
        console.warn('[points] point record page unavailable');
      }
    } finally {
      const finishedCurrent = pointQueryGate.finish(request);
      if (finishedCurrent && userStore.isAuthSessionCurrent(request.authSession)) {
        if (state.loadStatus === 'loading') {
          state.loadStatus = state.pagination.list.length > 0 ? 'more' : 'noMore';
        }
        state.initialLoading = false;
      }
    }
  }

  function reloadLogList() {
    pointQueryGate.invalidate();
    resetPagination(state.pagination);
    state.loadStatus = '';
    state.error = '';
    state.initialLoading = true;
    state.recordsReady = false;
    void getLogList();
  }

  function retryPointRecords() {
    reloadLogList();
  }

  function onChange(event) {
    state.currentTab = event.index;
    reloadLogList();
  }

  function onChangeTime(e) {
    if (!Array.isArray(e) || e.length === 0) {
      state.date = [];
    } else {
      state.date = [e[0], e[e.length - 1]];
    }
    reloadLogList();
  }

  function onLoadMore() {
    if (
      state.loadStatus === 'noMore' ||
      state.loadStatus === 'loading' ||
      pointQueryGate.isLoading()
    ) {
      return;
    }
    state.pagination.pageNo += 1;
    void getLogList();
  }

  async function refreshCurrentPointRecords() {
    const authSession = userStore.getAuthSessionSnapshot();
    pointQueryGate.invalidate();
    resetPagination(state.pagination);
    state.loadStatus = '';
    state.error = '';
    state.initialLoading = true;
    state.recordsReady = false;
    if (!userStore.isAuthSessionCurrent(authSession)) {
      state.initialLoading = false;
      state.error = '登录状态已更新，请重新进入积分记录';
      return;
    }
    try {
      await userStore.updateUserData(true);
    } catch (error) {
      console.warn('[points] member profile refresh unavailable');
    }
    if (!userStore.isAuthSessionCurrent(authSession)) {
      return;
    }
    await getLogList({ authSession });
  }

  onLoad(() => {
    state.today = dayjs().format('YYYY-MM-DD');
  });

  onShow(() => {
    pageVisible = true;
    void refreshCurrentPointRecords();
  });

  onHide(() => {
    pageVisible = false;
  });

  onReachBottom(() => {
    onLoadMore();
  });

  watch(
    () => userStore.authSessionEpoch,
    () => {
      pointQueryGate.invalidate();
      resetPagination(state.pagination);
      state.loadStatus = '';
      state.error = '';
      state.initialLoading = true;
      state.recordsReady = false;
      if (pageVisible) {
        void refreshCurrentPointRecords();
      }
    },
  );
</script>

<style lang="scss" scoped>
  .point-page {
    min-height: calc(100vh - 88rpx);
    padding: 24rpx 24rpx 60rpx;
    box-sizing: border-box;
    background: #f6f6f6;
  }

  .balance-card {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 34rpx;
    border-radius: 22rpx;
    background: linear-gradient(145deg, #ff6325 0%, #ff8b32 64%, #2b1f1b 145%);
    color: #ffffff;
    box-shadow: 0 12rpx 32rpx rgba(255, 90, 31, 0.18);
  }

  .balance-label {
    color: rgba(255, 255, 255, 0.76);
    font-size: 24rpx;
  }

  .balance-value {
    margin-top: 8rpx;
    font-size: 64rpx;
    font-weight: 900;
    line-height: 70rpx;
  }

  .record-total {
    padding: 10rpx 18rpx;
    border-radius: 24rpx;
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.86);
    font-size: 23rpx;
  }

  .filter-card {
    margin-top: 20rpx;
    overflow: hidden;
    border-radius: 20rpx;
    background: #ffffff;
    box-shadow: 0 8rpx 24rpx rgba(33, 20, 14, 0.05);
  }

  .date-btn {
    display: flex;
    align-items: center;
    height: 72rpx;
    margin: 20rpx 24rpx 8rpx;
    padding: 0 22rpx;
    border: 1rpx solid #eeeeee;
    border-radius: 36rpx;
    background: #f8f8f8;
    color: #555555;
    font-size: 24rpx;
    line-height: 72rpx;
  }

  .date-btn text {
    margin: 0 10rpx;
  }

  .state-card {
    display: flex;
    min-height: 360rpx;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    margin-top: 20rpx;
    padding: 40rpx;
    border-radius: 20rpx;
    background: #ffffff;
    text-align: center;
  }

  .state-title {
    margin-top: 18rpx;
    color: #242424;
    font-size: 30rpx;
    font-weight: 800;
  }

  .state-desc {
    margin-top: 10rpx;
    color: #888888;
    font-size: 24rpx;
    line-height: 36rpx;
  }

  .retry-btn {
    height: 66rpx;
    margin-top: 24rpx;
    padding: 0 32rpx;
    border: 0;
    border-radius: 34rpx;
    background: #ff5a1f;
    color: #ffffff;
    font-size: 25rpx;
    line-height: 66rpx;
  }

  .record-list {
    margin-top: 20rpx;
    overflow: hidden;
    border-radius: 20rpx;
    background: #ffffff;
  }

  .record-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 150rpx;
    padding: 24rpx 28rpx;
    border-bottom: 1rpx solid #eeeeee;
  }

  .record-item:last-child {
    border-bottom: 0;
  }

  .record-main {
    flex: 1;
    min-width: 0;
    padding-right: 20rpx;
  }

  .record-title {
    overflow: hidden;
    color: #262626;
    font-size: 27rpx;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .record-time,
  .balance-after {
    margin-top: 8rpx;
    color: #999999;
    font-size: 22rpx;
  }

  .balance-after {
    color: #777777;
  }

  .delta {
    color: #555555;
    font-size: 31rpx;
    font-weight: 800;
  }

  .delta.income {
    color: #ff5a1f;
  }

  .inline-error {
    margin-top: 16rpx;
    color: #8a8a8a;
    font-size: 23rpx;
    text-align: center;
  }

  .inline-error text {
    margin-left: 12rpx;
    color: #ff5a1f;
    font-weight: 700;
  }

  button::after {
    border: 0;
  }
</style>
