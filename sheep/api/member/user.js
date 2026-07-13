import request from '@/sheep/request';

const UserApi = {
  // 获得基本信息
  getUserInfo: () => {
    return request({
      url: '/skit/member/user/profile',
      method: 'GET',
      custom: {
        showLoading: false,
        auth: true,
      },
    });
  },
};

export default UserApi;
