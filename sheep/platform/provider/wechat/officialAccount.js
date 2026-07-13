import $wxsdk from '@/sheep/libs/sdk-h5-weixin';
import sheep from '@/sheep';

// 身份登录由短剧邀请制页面负责。JSSDK 仅在调用方提供租户化签名后初始化。
async function load() {}

async function getOpenid() {
  return uni.getStorageSync('openid') || '';
}

function requestMerchantTransfer(mchId, packageInfo, successCallback, failCallback) {
  $wxsdk.requestMerchantTransfer(
    {
      mchId,
      package: packageInfo,
    },
    {
      success: (res) => {
        successCallback && successCallback({ result: 'success', ...res });
      },
      cancel: (res) => {
        sheep.$helper.toast('确认收款已取消');
        failCallback && failCallback({ result: 'cancel', errMsg: '确认收款已取消', ...res });
      },
      fail: (res) => {
        sheep.$helper.toast(res.errMsg || '确认收款失败');
        failCallback && failCallback({ result: 'fail', ...res });
      },
    },
  );
}

export default {
  load,
  getOpenid,
  requestMerchantTransfer,
  jsWxSdk: $wxsdk,
};
