import request from '@/sheep/request';

const SignInApi = {
  // 获得个人签到统计
  getSignInRecordSummary: () => {
    return request({
      url: '/skit/member/check-ins/summary',
      method: 'GET',
    });
  },
  // 签到
  createSignInRecord: () => {
    return request({
      url: '/skit/member/check-ins',
      method: 'POST',
    });
  },
};

export default SignInApi;
