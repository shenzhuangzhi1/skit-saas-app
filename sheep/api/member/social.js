import request from '@/sheep/request';

const SocialApi = {
  // 获取订阅消息模板列表
  getSubscribeTemplateList: () =>
    request({
      url: '/member/social-user/get-subscribe-template-list',
      method: 'GET',
      custom: {
        showError: false,
        showLoading: false,
      },
    }),
  // 获取微信小程序码
  getWxaQrcode: async (path, query) => {
    return await request({
      url: '/member/social-user/wxa-qrcode',
      method: 'POST',
      data: {
        scene: query,
        path,
        checkPath: false, // TODO 开发环境暂不检查 path 是否存在
      },
    });
  },
};

export default SocialApi;
