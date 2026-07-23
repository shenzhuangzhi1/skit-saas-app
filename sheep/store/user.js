import { defineStore } from 'pinia';
import { clone, cloneDeep } from 'lodash-es';
import UserApi from '@/sheep/api/member/user';
import AdConfigApi from '@/sheep/api/member/ad-config';
import PayWalletApi from '@/sheep/api/pay/wallet';
import OrderApi from '@/sheep/api/trade/order';
import CouponApi from '@/sheep/api/promotion/coupon';
import safeUni from '@/sheep/helper/uni';
import { displayAdFlow } from '@/pages/drama/services/display-ad-flow.mjs';
import { clearDramaMemberScope, setDramaMemberScope } from '@/pages/drama/data';

const SKIT_AUTH_DOMAIN = 'skit_member';
const DEFAULT_TENANT_SCOPE = '__default__';
const BUILT_AGENT_CODE = String(import.meta.env?.VITE_SKIT_AGENT_CODE || '')
  .trim()
  .toUpperCase();
const persistedToken = safeUni.getStorageSync('token');
const persistedAuthDomain = safeUni.getStorageSync('auth-domain');
if (persistedToken && persistedAuthDomain !== SKIT_AUTH_DOMAIN) {
  safeUni.removeStorageSync('token');
  safeUni.removeStorageSync('refresh-token');
  safeUni.removeStorageSync('token-expires-time');
}

function activeTenantScope() {
  const tenantId = String(safeUni.getStorageSync('tenant-id') ?? '').trim();
  return tenantId || DEFAULT_TENANT_SCOPE;
}

function identityOf(value = {}) {
  return {
    tenantId: String(value.tenantId ?? '').trim(),
    memberId: String(value.userId ?? value.id ?? '').trim(),
  };
}

// 默认用户信息
const defaultUserInfo = {
  id: undefined,
  userId: undefined,
  avatar: '', // 头像
  nickname: '', // 昵称
  gender: 0, // 性别
  mobile: '', // 手机号
  pointBalance: 0, // 当前 Skit 会员积分
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
    adConfigTenantId: '', // 广告配置必须绑定到发起请求时的租户
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
      setDramaMemberScope(this.userInfo);
      return Promise.resolve(this.userInfo);
    },

    // 获取当前代理商广告配置（前端仅消费公开字段）
    async getAdConfig() {
      const tenantScopeBeforeBootstrap = activeTenantScope();
      if (BUILT_AGENT_CODE) {
        try {
          const { ensureMemberAppContext } = await import('@/sheep/services/member-app-context');
          await ensureMemberAppContext(BUILT_AGENT_CODE);
        } catch (error) {
          this.clearDisplayAdConfig();
          throw error;
        }
      }
      const requestTenantScope = activeTenantScope();
      if (
        tenantScopeBeforeBootstrap !== DEFAULT_TENANT_SCOPE &&
        tenantScopeBeforeBootstrap !== requestTenantScope &&
        this.isLogin
      ) {
        this.resetUserData();
      }
      if (this.adConfigTenantId !== requestTenantScope) {
        this.clearDisplayAdConfig();
      }
      const result = await AdConfigApi.getAdConfig();
      // 租户切换可能发生在请求途中，迟到响应不可污染新租户。
      if (activeTenantScope() !== requestTenantScope) {
        return;
      }
      if (result?.code !== 0) {
        return;
      }
      this.adConfig = result.data || {};
      this.adConfigTenantId = requestTenantScope;
      return this.adConfig;
    },

    clearDisplayAdConfig() {
      this.adConfig = {};
      this.adConfigTenantId = '';
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
      const previousIdentity = identityOf(this.userInfo);
      const nextIdentity = identityOf({
        tenantId: data.tenantId,
        userId: data.userId,
      });
      const identityChanged =
        !previousIdentity.tenantId ||
        !previousIdentity.memberId ||
        previousIdentity.tenantId !== nextIdentity.tenantId ||
        previousIdentity.memberId !== nextIdentity.memberId;
      if (identityChanged) {
        displayAdFlow.clearPostCheckInMarker();
      }
      if (
        previousIdentity.tenantId &&
        previousIdentity.tenantId !== nextIdentity.tenantId
      ) {
        this.clearDisplayAdConfig();
      }
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
      setDramaMemberScope(nextIdentity);
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
      this.clearDisplayAdConfig();
      displayAdFlow.clearPostCheckInMarker();
      clearDramaMemberScope();
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
