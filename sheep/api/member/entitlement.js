import request from '@/sheep/request';

const EntitlementApi = {
  getEntitlements: (dramaId) =>
    request({
      url: '/skit/member/entitlements',
      method: 'GET',
      params: { dramaId },
      custom: {
        auth: true,
        showLoading: false,
        showError: false,
      },
    }),
};

export default EntitlementApi;
