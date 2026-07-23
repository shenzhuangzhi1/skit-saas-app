import request from '@/sheep/request';

const PointApi = {
  // 获得用户积分记录分页
  getPointRecordPage: (params = {}) =>
    request({
      url: '/skit/member/point-records',
      method: 'GET',
      params,
    }),
};

export default PointApi;
