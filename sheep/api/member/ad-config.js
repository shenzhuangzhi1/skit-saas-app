import request from '@/sheep/request';

const AdConfigApi = {
  getAdConfig: () => {
    return request({
      url: '/skit/member/ad-config',
      method: 'GET',
      custom: {
        auth: true,
        showLoading: false,
      },
    });
  },
};

export default AdConfigApi;
