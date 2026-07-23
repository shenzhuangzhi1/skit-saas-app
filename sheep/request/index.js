/**
 * Shopro-request
 * @description api模块管理，loading配置，请求拦截，错误处理
 */

import Request from 'luch-request';
import { apiPath, baseUrl, tenantId } from '@/sheep/config';
import $store from '@/sheep/store';
import $platform from '@/sheep/platform';
import { showAuthModal } from '@/sheep/hooks/useModal';
import AuthUtil from '@/sheep/api/member/auth';
import { getTerminal } from '@/sheep/helper/const';
import safeUni from '@/sheep/helper/uni';
import { buildClientRuntimeHeaders, getClientRuntimeInfo } from '@/sheep/services/client-runtime';
import { formatAuthFailure } from '@/pages/auth/auth-completion.mjs';

const CLIENT_RUNTIME_PATH_PATTERN =
  /\/skit\/member\/(?:player-grants|entitlements|ad-sessions(?:\/|$))/;

const options = {
  // 显示操作成功消息 默认不显示
  showSuccess: false,
  // 成功提醒 默认使用后端返回值
  successMsg: '',
  // 显示失败消息 默认显示
  showError: true,
  // 失败提醒 默认使用后端返回信息
  errorMsg: '',
  // 显示请求时loading模态框 默认显示
  showLoading: true,
  // loading提醒文字
  loadingMsg: '加载中',
  // 需要授权才能请求 默认放开
  auth: false,
  // 是否传递 token
  isToken: true,
  // 是否传递租户编号；邀请解析等公开接口需要关闭
  tenant: true,
};

// Loading全局实例
let LoadingInstance = {
  target: null,
  count: 0,
};

/**
 * 关闭loading
 */
function closeLoading() {
  if (LoadingInstance.count > 0) LoadingInstance.count--;
  if (LoadingInstance.count === 0) uni.hideLoading();
}

/**
 * @description 请求基础配置 可直接使用访问自定义请求
 */
const http = new Request({
  baseURL: baseUrl + apiPath,
  timeout: 8000,
  method: 'GET',
  header: {
    Accept: 'text/json',
    'Content-Type': 'application/json;charset=UTF-8',
    platform: $platform.name,
  },
  // #ifdef APP-PLUS
  // Never bypass TLS certificate validation for login credentials or bearer tokens.
  sslVerify: true,
  // #endif
  // #ifdef H5
  // 跨域请求时是否携带凭证（cookies）仅H5支持（HBuilderX 2.6.15+）
  withCredentials: false,
  // #endif
  custom: options,
});

/**
 * @description 请求拦截器
 */
http.interceptors.request.use(
  async (config) => {
    const userStore = $store('user');
    config.custom = { ...config.custom };
    if (config.custom.authSessionEpoch === undefined) {
      config.custom.authSessionEpoch = userStore.authSessionEpoch;
    }
    // 自定义处理【auth 授权】：必须登录的接口，则跳出 AuthModal 登录弹窗
    if (config.custom.auth && !userStore.isLogin) {
      showAuthModal();
      return Promise.reject();
    }

    // 自定义处理【loading 加载中】：如果需要显示 loading，则显示 loading
    if (config.custom.showLoading) {
      LoadingInstance.count++;
      LoadingInstance.count === 1 &&
        uni.showLoading({
          title: config.custom.loadingMsg,
          mask: true,
          fail: () => {
            uni.hideLoading();
          },
        });
    }

    // 增加 token 令牌、terminal 终端、tenant 租户的请求头
    const token = config.custom.isToken ? getAccessToken() : undefined;
    if (token) {
      config.header['Authorization'] = getAuthorizationHeader(token);
    }
    config.header['terminal'] = getTerminal();

    config.header['Accept'] = '*/*';
    if (config.custom.tenant !== false) {
      const requestTenantId = getTenantId();
      if (String(requestTenantId ?? '').trim()) {
        config.header['tenant-id'] = requestTenantId;
      } else {
        delete config.header['tenant-id'];
      }
    } else {
      delete config.header['tenant-id'];
    }

    if (CLIENT_RUNTIME_PATH_PATTERN.test(String(config.url || ''))) {
      const runtime = await getClientRuntimeInfo();
      Object.assign(config.header, buildClientRuntimeHeaders(runtime));
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

/**
 * @description 响应拦截器
 */
http.interceptors.response.use(
  (response) => {
    // 先结束本次 loading；即使后续判定为迟到会话也不能把遮罩留在页面上。
    response.config.custom.showLoading && closeLoading();

    // 登录/注册会开启新会话；刷新只能更新发起它的原会话。
    if (
      response.config.url.indexOf('/skit/member/auth/') >= 0 &&
      response.data?.data?.accessToken
    ) {
      const authData = response.data.data;
      const userStore = $store('user');
      if (response.config.url.indexOf('/skit/member/auth/refresh-token') >= 0) {
        const applied = userStore.applyRefreshResult(
          authData,
          response.config.custom?.authSessionEpoch,
        );
        if (!applied) {
          return Promise.reject(staleAuthSessionError());
        }
      } else {
        const applied = userStore.beginAuthSession(
          authData,
          response.config.custom?.authSessionEpoch,
        );
        if (!applied) {
          return Promise.reject(staleAuthSessionError());
        }
      }
    }

    // 自定义处理【error 错误提示】：如果需要显示错误提示，则显示错误提示
    if (response.data.code !== 0) {
      // 特殊：如果 401 错误码，则跳转到登录页 or 刷新令牌
      if (response.data.code === 401) {
        console.warn(
          formatAuthFailure({
            stage: 'business-response',
            httpStatus: response.statusCode,
            code: response.data.code,
            url: response.config.url,
          }),
        );
        return refreshToken(response.config);
      }
      // 特殊：处理分销用户绑定失败的提示
      if ((response.data.code + '').includes('1011007')) {
        console.error(`分销用户绑定失败，原因：${response.data.msg}`);
      } else if (response.config.custom.showError) {
        // 错误提示
        uni.showToast({
          title: response.data.msg || '服务器开小差啦,请稍后再试~',
          icon: 'none',
          mask: true,
        });
      }
    }

    // 自定义处理【showSuccess 成功提示】：如果需要显示成功提示，则显示成功提示
    if (
      response.config.custom.showSuccess &&
      response.config.custom.successMsg !== '' &&
      response.data.code === 0
    ) {
      uni.showToast({
        title: response.config.custom.successMsg,
        icon: 'none',
      });
    }

    // 返回结果：包括 code + data + msg
    return Promise.resolve(response.data);
  },
  (error) => {
    let errorMessage = '网络请求出错';
    if (error !== undefined) {
      switch (error.statusCode) {
        case 400:
          errorMessage = '请求错误';
          break;
        case 401:
          if (!error.config) {
            errorMessage = '您的登陆已过期';
            break;
          }
          console.warn(
            formatAuthFailure({
              stage: 'transport-response',
              httpStatus: error.statusCode,
              code: error.data?.code ?? error.statusCode,
              url: error.config.url,
            }),
          );
          error.config.custom?.showLoading && closeLoading();
          return refreshToken(error.config);
        case 403:
          errorMessage = '拒绝访问';
          break;
        case 404:
          errorMessage = '请求出错';
          break;
        case 408:
          errorMessage = '请求超时';
          break;
        case 429:
          errorMessage = '请求频繁, 请稍后再访问';
          break;
        case 500:
          errorMessage = '服务器开小差啦,请稍后再试~';
          break;
        case 501:
          errorMessage = '服务未实现';
          break;
        case 502:
          errorMessage = '网络错误';
          break;
        case 503:
          errorMessage = '服务不可用';
          break;
        case 504:
          errorMessage = '网络超时';
          break;
        case 505:
          errorMessage = 'HTTP 版本不受支持';
          break;
      }
      if (error.errMsg?.includes('timeout')) errorMessage = '请求超时';
      // #ifdef H5
      if (error.errMsg?.includes('Network'))
        errorMessage = window.navigator.onLine ? '服务器异常' : '请检查您的网络连接';
      // #endif
    }

    if (error && error.config) {
      if (error.config.custom.showError) {
        uni.showToast({
          title: error.data?.msg || errorMessage,
          icon: 'none',
          mask: true,
        });
      }
      error.config.custom.showLoading && closeLoading();
    }

    return false;
  },
);

// 每个登录世代只允许一个刷新请求；旧世代完成后不能写入、重放或清理新会话。
const refreshFlights = new Map();

const staleAuthSessionError = () => ({
  code: 'AUTH_SESSION_STALE',
  msg: '登录会话已更新',
});

const rejectStaleAuthSession = () => Promise.reject(staleAuthSessionError());

const getRefreshFlight = (expectedEpoch, refreshTokenValue) => {
  const currentFlight = refreshFlights.get(expectedEpoch);
  if (currentFlight) {
    return currentFlight;
  }

  let flight;
  flight = (async () => {
    try {
      const refreshTokenResult = await AuthUtil.refreshToken(refreshTokenValue, expectedEpoch);
      const userStore = $store('user');
      if (
        !userStore.isAuthEpochCurrent(expectedEpoch) ||
        refreshTokenResult?.code !== 0 ||
        !userStore.isLogin
      ) {
        throw staleAuthSessionError();
      }
      return getAccessToken();
    } finally {
      if (refreshFlights.get(expectedEpoch) === flight) {
        refreshFlights.delete(expectedEpoch);
      }
    }
  })();
  refreshFlights.set(expectedEpoch, flight);
  return flight;
};

const refreshToken = async (config) => {
  // 刷新接口自身失败时不能递归刷新。
  if (config.url.indexOf('/skit/member/auth/refresh-token') >= 0) {
    return Promise.reject(staleAuthSessionError());
  }

  const userStore = $store('user');
  const expectedEpoch = config.custom?.authSessionEpoch;
  if (!userStore.isAuthEpochCurrent(expectedEpoch)) {
    return rejectStaleAuthSession();
  }
  if (Number(config.custom?.authRefreshAttempts || 0) >= 1) {
    return handleAuthorized(expectedEpoch);
  }

  const refreshTokenValue = getRefreshToken();
  if (!refreshTokenValue) {
    return handleAuthorized(expectedEpoch);
  }

  try {
    const accessToken = await getRefreshFlight(expectedEpoch, refreshTokenValue);
    if (!userStore.isAuthEpochCurrent(expectedEpoch) || !accessToken) {
      return rejectStaleAuthSession();
    }
    config.header.Authorization = getAuthorizationHeader(accessToken);
    config.custom.authRefreshAttempts = 1;
    const replayResult = await request(config);
    if (!userStore.isAuthEpochCurrent(expectedEpoch)) {
      return rejectStaleAuthSession();
    }
    return replayResult;
  } catch {
    if (!userStore.isAuthEpochCurrent(expectedEpoch)) {
      return rejectStaleAuthSession();
    }
    return handleAuthorized(expectedEpoch);
  }
};

/**
 * 处理 401 未登录的错误
 */
const handleAuthorized = (expectedEpoch) => {
  const userStore = $store('user');
  if (!userStore.isAuthEpochCurrent(expectedEpoch)) {
    return rejectStaleAuthSession();
  }
  const wasLogin = userStore.isLogin;
  // Token 已失效时只清理本地状态，避免 logout 接口再次 401 形成递归刷新。
  userStore.resetUserData();
  showAuthModal();
  // 登录超时
  return Promise.reject({
    code: 401,
    msg: wasLogin ? '您的登陆已过期' : '请先登录',
  });
};

/** 获得访问令牌 */
export const getAccessToken = () => {
  return safeUni.getStorageSync('token');
};

/** 获得刷新令牌 */
export const getRefreshToken = () => {
  return safeUni.getStorageSync('refresh-token');
};

const getAuthorizationHeader = (token) => {
  const value = String(token || '');
  return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
};

/** 获得租户编号 */
export const getTenantId = () => {
  const storedTenantId = safeUni.getStorageSync('tenant-id');
  const BUILT_AGENT_CODE = String(import.meta.env?.VITE_SKIT_AGENT_CODE || '').trim();
  if (BUILT_AGENT_CODE) {
    return storedTenantId || undefined;
  }
  return storedTenantId || tenantId;
};

const request = (config) => {
  return http.middleware(config);
};

export default request;
