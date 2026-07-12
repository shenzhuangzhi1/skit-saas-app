import request from '@/sheep/request';

const AppReleaseApi = {
  current: (params) => {
    return request({
      url: '/skit/app/release/current',
      method: 'GET',
      params,
      custom: {
        auth: false,
        isToken: false,
        tenant: false,
        showLoading: false,
        showError: false,
      },
    });
  },
};

export default AppReleaseApi;
