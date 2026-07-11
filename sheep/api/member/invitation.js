import request from '@/sheep/request';

const InvitationApi = {
  // 登录前通过邀请码解析代理商与邀请人公开信息
  resolve: (code) => {
    return request({
      url: '/skit/member/invitation/resolve',
      method: 'GET',
      params: { code },
      custom: {
        auth: false,
        isToken: false,
        tenant: false,
        showLoading: false,
        showError: false,
      },
    });
  },

  // 获取当前用户的直属下级
  getChildren: (params) => {
    return request({
      url: '/skit/member/invitation/children',
      method: 'GET',
      params,
      custom: {
        auth: true,
        showLoading: false,
      },
    });
  },
};

export default InvitationApi;
