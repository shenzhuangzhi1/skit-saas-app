<!-- 我的积分 -->
<template>
  <s-layout class="wallet-wrap" title="我的积分" navbar="inner">
    <view
      class="header-box ss-flex ss-flex-col ss-row-center ss-col-center"
      :style="[
        {
          marginTop: '-' + Number(statusBarHeight + 88) + 'rpx',
          paddingTop: Number(statusBarHeight + 88) + 'rpx',
        },
      ]"
    >
      <view class="header-bg">
        <view class="bg" />
      </view>
      <view class="score-box ss-flex-col ss-row-center ss-col-center">
        <view class="ss-m-b-30">
          <text class="all-title ss-m-r-8">当前积分</text>
        </view>
        <text class="all-num">{{ userInfo.pointBalance || 0 }}</text>
      </view>
    </view>
    <!-- tab -->
    <su-sticky :customNavHeight="sys_navBar">
      <!-- 统计 -->
      <view class="filter-box ss-p-x-30 ss-flex ss-col-center ss-row-between">
        <uni-datetime-picker
          v-model="state.date"
          type="daterange"
          @change="onChangeTime"
          :end="state.today"
        >
          <button class="ss-reset-button date-btn">
            <text>{{ dateFilterText }}</text>
            <text class="cicon-drop-down ss-seldate-icon"></text>
          </button>
        </uni-datetime-picker>
      </view>
      <su-tabs
        :list="tabMaps"
        @change="onChange"
        :scrollable="false"
        :current="state.currentTab"
      ></su-tabs>
    </su-sticky>

    <!-- list -->
    <view class="list-box">
      <view v-if="state.pagination.total > 0">
        <view
          class="list-item ss-flex ss-col-center ss-row-between"
          v-for="item in state.pagination.list"
          :key="item.id"
        >
          <view class="ss-flex-col">
            <view class="name"
              >{{ item.title }}{{ item.description ? ' - ' + item.description : '' }}</view
            >
            <view class="time">{{
              sheep.$helper.timeFormat(item.createTime, 'yyyy-mm-dd hh:MM:ss')
            }}</view>
          </view>
          <view class="add" v-if="item.pointDelta > 0">+{{ item.pointDelta }}</view>
          <view class="minus" v-else>{{ item.pointDelta }}</view>
        </view>
      </view>
      <s-empty v-else text="暂无数据" icon="/static/data-empty.png" />
    </view>

    <uni-load-more
      v-if="state.pagination.total > 0"
      :status="state.loadStatus"
      :content-text="{
        contentdown: '上拉加载更多',
      }"
      @tap="onLoadMore"
    />
  </s-layout>
</template>

<script setup>
  import sheep from '@/sheep';
  import { onLoad, onReachBottom } from '@dcloudio/uni-app';
  import { computed, reactive } from 'vue';
  import { concat } from 'lodash-es';
  import dayjs from 'dayjs';
  import PointApi from '@/sheep/api/member/point';
  import { resetPagination } from '@/sheep/helper/utils';
  import { createPointRecordQueryGate } from './point-record-query.mjs';

  const statusBarHeight = sheep.$platform.device.statusBarHeight * 2;
  const userInfo = computed(() => sheep.$store('user').userInfo);
  const sys_navBar = sheep.$platform.navbar;
  const pointQueryGate = createPointRecordQueryGate();

  const state = reactive({
    currentTab: 0,
    pagination: {
      list: [],
      total: 0,
      pageSize: 6,
      pageNo: 1,
    },
    loadStatus: '',
    date: [],
    today: '',
  });

  const tabMaps = [
    {
      name: '全部',
      value: 'all',
    },
    {
      name: '收入',
      value: 'true',
    },
    {
      name: '支出',
      value: 'false',
    },
  ];

  const dateFilterText = computed(() => {
    if (!state.date.length) {
      return '全部日期';
    }
    if (state.date[0] === state.date[1]) {
      return state.date[0];
    } else {
      return state.date.join('~');
    }
  });

  function currentFilterSignature() {
    return JSON.stringify({
      currentTab: state.currentTab,
      date: [...state.date],
    });
  }

  async function getLogList() {
    if (state.loadStatus === 'loading' || pointQueryGate.isLoading()) {
      return;
    }
    const request = pointQueryGate.tryStart({
      pageNo: state.pagination.pageNo,
      filterSignature: currentFilterSignature(),
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
    state.loadStatus = 'loading';
    try {
      const { code, data } = await PointApi.getPointRecordPage(params);
      if (
        !pointQueryGate.isCurrent(request) ||
        request.filterSignature !== currentFilterSignature() ||
        request.pageNo !== state.pagination.pageNo
      ) {
        return;
      }
      if (code !== 0) {
        if (request.pageNo > 1) {
          state.pagination.pageNo = request.pageNo - 1;
        }
        state.loadStatus = state.pagination.list.length > 0 ? 'more' : 'noMore';
        return;
      }
      const rows = Array.isArray(data?.list) ? data.list : [];
      state.pagination.list =
        request.pageNo === 1 ? rows : concat(state.pagination.list, rows);
      state.pagination.total = Number(data?.total) || 0;
      state.loadStatus =
        state.pagination.list.length < state.pagination.total ? 'more' : 'noMore';
    } catch (error) {
      if (pointQueryGate.isCurrent(request)) {
        if (request.pageNo > 1) {
          state.pagination.pageNo = request.pageNo - 1;
        }
        state.loadStatus = state.pagination.list.length > 0 ? 'more' : 'noMore';
        console.warn('[points] point record page unavailable', error);
      }
    } finally {
      if (pointQueryGate.finish(request) && state.loadStatus === 'loading') {
        state.loadStatus = state.pagination.list.length > 0 ? 'more' : 'noMore';
      }
    }
  }

  function reloadLogList() {
    pointQueryGate.invalidate();
    resetPagination(state.pagination);
    state.loadStatus = '';
    void getLogList();
  }

  onLoad(async () => {
    state.today = dayjs().format('YYYY-MM-DD');
    try {
      await sheep.$store('user').updateUserData(true);
    } catch (error) {
      console.warn('[points] member profile refresh unavailable', error);
    }
    await getLogList();
  });

  function onChange(e) {
    state.currentTab = e.index;
    reloadLogList();
  }

  function onChangeTime(e) {
    state.date[0] = e[0];
    state.date[1] = e[e.length - 1];
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
    state.pagination.pageNo++;
    void getLogList();
  }

  onReachBottom(() => {
    onLoadMore();
  });
</script>

<style lang="scss" scoped>
  .header-box {
    width: 100%;
    background: linear-gradient(180deg, var(--ui-BG-Main) 0%, var(--ui-BG-Main-gradient) 100%)
      no-repeat;
    background-size: 750rpx 100%;
    padding: 0 0 120rpx 0;
    box-sizing: border-box;

    .score-box {
      height: 100%;

      .all-num {
        font-size: 50rpx;
        font-weight: bold;
        color: #fff;
        font-family: OPPOSANS;
      }

      .all-title {
        font-size: 26rpx;
        font-weight: 500;
        color: #fff;
      }

      .cicon-help-o {
        color: #fff;
        font-size: 28rpx;
      }
    }
  }

  // 筛选
  .filter-box {
    height: 114rpx;
    background-color: $bg-page;

    .total-box {
      font-size: 24rpx;
      font-weight: 500;
      color: $dark-9;
    }

    .date-btn {
      background-color: $white;
      line-height: 54rpx;
      border-radius: 27rpx;
      padding: 0 20rpx;
      font-size: 24rpx;
      font-weight: 500;
      color: $dark-6;

      .ss-seldate-icon {
        font-size: 50rpx;
        color: $dark-9;
      }
    }
  }

  .list-box {
    .list-item {
      background: #fff;
      border-bottom: 1rpx solid #dfdfdf;
      padding: 30rpx;

      .name {
        font-size: 28rpx;

        font-weight: 500;
        color: rgba(102, 102, 102, 1);
        line-height: 28rpx;
        margin-bottom: 20rpx;
      }

      .time {
        font-size: 24rpx;

        font-weight: 500;
        color: rgba(196, 196, 196, 1);
        line-height: 24px;
      }

      .add {
        font-size: 30rpx;

        font-weight: 500;
        color: #e6b873;
      }

      .minus {
        font-size: 30rpx;

        font-weight: 500;
        color: $dark-3;
      }
    }
  }
</style>
