import request from '@/sheep/request';

const AdRevenueApi = {
  acknowledgeLegacyMigration: () =>
    request({
      url: '/skit/member/ad-revenue/report',
      method: 'POST',
      data: {},
      custom: {
        auth: true,
        showLoading: false,
        showError: false,
      },
    }),
};

export default AdRevenueApi;
