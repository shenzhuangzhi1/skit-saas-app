import request from '@/sheep/request';

const AuthUtil = {
  // 根据白标 App 内置的代理商代码换取短时、不透明的登录上下文。
  bootstrap: (data) => {
    return request({
      url: '/skit/member/auth/bootstrap',
      method: 'POST',
      data,
      custom: {
        isToken: false,
        tenant: false,
        showLoading: false,
        showError: false,
      },
    });
  },
  // 使用手机 + 密码登录
  login: (data) => {
    return request({
      url: '/skit/member/auth/login',
      method: 'POST',
      data,
      custom: {
        isToken: false,
        // 租户由短时 App 上下文令牌确定，不能携带旧租户请求头。
        tenant: false,
        showSuccess: true,
        loadingMsg: '登录中',
        successMsg: '登录成功',
      },
    });
  },
  // 使用邀请码注册账号
  register: (data) => {
    return request({
      url: '/skit/member/auth/register',
      method: 'POST',
      data,
      custom: {
        isToken: false,
        tenant: false,
        showSuccess: true,
        loadingMsg: '注册中',
        successMsg: '注册成功',
      },
    });
  },
  // 登出系统
  logout: () => {
    return request({
      url: '/skit/member/auth/logout',
      method: 'POST',
      custom: {
        showLoading: false,
        showError: false,
      },
    });
  },
  // 刷新令牌
  refreshToken: (refreshToken) => {
    return request({
      url: '/skit/member/auth/refresh-token',
      method: 'POST',
      params: {
        refreshToken,
      },
      custom: {
        isToken: false,
        showLoading: false, // 不用加载中
        showError: false, // 不展示错误提示
      },
    });
  },
};

export default AuthUtil;
