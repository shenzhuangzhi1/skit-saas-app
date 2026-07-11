import { defineStore } from 'pinia';
import { clone, cloneDeep } from 'lodash-es';
import UserApi from '@/sheep/api/member/user';
import AdConfigApi from '@/sheep/api/member/ad-config';
import PayWalletApi from '@/sheep/api/pay/wallet';
import OrderApi from '@/sheep/api/trade/order';
import CouponApi from '@/sheep/api/promotion/coupon';
import safeUni from '@/sheep/helper/uni';

const SKIT_AUTH_DOMAIN = 'skit_member';
const persistedToken = safeUni.getStorageSync('token');
const persistedAuthDomain = safeUni.getStorageSync('auth-domain');
if (persistedToken && persistedAuthDomain !== SKIT_AUTH_DOMAIN) {
  safeUni.removeStorageSync('token');
  safeUni.removeStorageSync('refresh-token');
  safeUni.removeStorageSync('token-expires-time');
}

// 默认用户信息
const defaultUserInfo = {
  id: undefined,
  userId: undefined,
  avatar: '', // 头像
  nickname: '', // 昵称
  gender: 0, // 性别
  mobile: '', // 手机号
  point: 0, // 积分
  tenantId: undefined,
  tenantCode: '',
  tenantName: '',
  agentName: '',
  inviteCode: '',
};

// 保留商城兼容状态，避免仓库内仍存在的旧页面读取 undefined；短剧登录后不会主动请求这些旧接口。
const defaultUserWallet = {
  balance: 0,
};

const defaultNumData = {
  unusedCouponCount: 0,
  orderCount: {
    allCount: 0,
    unpaidCount: 0,
    undeliveredCount: 0,
    deliveredCount: 0,
    uncommentedCount: 0,
    afterSaleCount: 0,
  },
};

const user = defineStore('user', {
  state: () => ({
    userInfo: clone(defaultUserInfo), // 用户信息
    adConfig: {}, // 当前代理商公开的广告配置
    userWallet: clone(defaultUserWallet),
    numData: cloneDeep(defaultNumData),
    expiresTime: safeUni.getStorageSync('token-expires-time') || 0,
    isLogin:
      !!safeUni.getStorageSync('token') &&
      safeUni.getStorageSync('auth-domain') === SKIT_AUTH_DOMAIN, // 登录状态
    lastUpdateTime: 0, // 上次更新时间
  }),

  actions: {
    // 获取用户信息
    async getInfo() {
      const result = await UserApi.getUserInfo();
      if (!result || result.code !== 0) {
        return;
      }
      const { data } = result;
      this.userInfo = {
        ...clone(defaultUserInfo),
        ...this.userInfo,
        ...data,
      };
      return Promise.resolve(this.userInfo);
    },

    // 获取当前代理商广告配置（前端仅消费公开字段）
    async getAdConfig() {
      const result = await AdConfigApi.getAdConfig();
      if (result?.code !== 0) {
        return;
      }
      this.adConfig = result.data || {};
      return this.adConfig;
    },

    // 旧商城页面的按需兼容方法；短剧主流程不会主动调用。
    async getWallet() {
      const { code, data } = await PayWalletApi.getPayWallet();
      if (code === 0) {
        this.userWallet = data;
      }
    },

    getNumData() {
      OrderApi.getOrderCount().then((res) => {
        if (res.code === 0) {
          this.numData.orderCount = res.data;
        }
      });
      CouponApi.getUnusedCouponCount().then((res) => {
        if (res.code === 0) {
          this.numData.unusedCouponCount = res.data;
        }
      });
    },

    // 暂存登录/注册响应中的身份信息，随后 profile 会补齐完整资料
    applyAuthResult(data = {}) {
      // 新登录和令牌刷新都先丢弃旧租户的公开配置，避免网络失败时继续使用旧广告账号。
      this.adConfig = {};
      if (data.expiresTime !== undefined && data.expiresTime !== null) {
        this.expiresTime = data.expiresTime;
        uni.setStorageSync('token-expires-time', data.expiresTime);
      }
      this.userInfo = {
        ...clone(defaultUserInfo),
        id: data.userId,
        userId: data.userId,
        tenantId: data.tenantId,
        inviteCode: data.inviteCode || '',
      };
    },

    // 设置 token
    setToken(token = '', refreshToken = '') {
      if (token === '') {
        this.isLogin = false;
        uni.removeStorageSync('token');
        uni.removeStorageSync('refresh-token');
        uni.removeStorageSync('auth-domain');
      } else {
        this.isLogin = true;
        uni.setStorageSync('token', token);
        uni.setStorageSync('refresh-token', refreshToken);
        uni.setStorageSync('auth-domain', SKIT_AUTH_DOMAIN);
        this.loginAfter();
      }
      return this.isLogin;
    },

    // 更新用户相关信息 (手动限流，5 秒之内不刷新)
    async updateUserData(force = false) {
      if (!this.isLogin) {
        this.resetUserData();
        return;
      }
      // 防抖，5 秒之内不刷新
      const nowTime = new Date().getTime();
      if (!force && this.lastUpdateTime + 5000 > nowTime) {
        return;
      }
      this.lastUpdateTime = nowTime;

      // 获取最新信息
      await this.getInfo();
      if (!this.isLogin) {
        return;
      }
      await this.getAdConfig();
      return this.userInfo;
    },

    // 重置用户默认数据
    resetUserData() {
      // 清空 token
      this.setToken();
      // 清空用户相关的缓存
      this.userInfo = clone(defaultUserInfo);
      this.adConfig = {};
      this.userWallet = clone(defaultUserWallet);
      this.numData = cloneDeep(defaultNumData);
      this.expiresTime = 0;
      uni.removeStorageSync('token-expires-time');
    },

    // 登录后，加载各种信息
    async loginAfter() {
      this.lastUpdateTime = 0;
      await this.updateUserData(true);
    },

    // 登出系统
    async logout(remote = true) {
      if (remote && this.isLogin) {
        try {
          const { default: AuthUtil } = await import('@/sheep/api/member/auth');
          await AuthUtil.logout();
        } catch (error) {
          console.warn('[auth] server logout failed; local session will still be cleared', error);
        }
      }
      this.resetUserData();
      return !this.isLogin;
    },
  },
  persist: {
    enabled: true,
    strategies: [
      {
        key: 'user-store',
      },
    ],
  },
});

export default user;
