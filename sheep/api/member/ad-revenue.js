import request from '@/sheep/request';

const AdRevenueApi = {
  report: (data) =>
    request({
      url: '/skit/member/ad-revenue/report',
      method: 'POST',
      data,
      custom: {
        auth: true,
        showLoading: false,
        showError: false,
      },
    }),
};

export default AdRevenueApi;
