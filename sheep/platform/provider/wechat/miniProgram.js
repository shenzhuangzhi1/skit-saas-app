import SocialApi from '@/sheep/api/member/social';
import sheep from '@/sheep';

let subscribeEventList = [];

// 小程序平台初始化只处理更新和订阅模板，不参与会员登录。
function load() {
  checkUpdate();
  getSubscribeTemplate();
}

// 微信支付可能由宿主预先注入 openid；App 不再通过通用会员接口自动绑定身份。
async function getOpenid() {
  return uni.getStorageSync('openid') || '';
}

const checkUpdate = async (silence = true) => {
  if (!uni.canIUse('getUpdateManager')) {
    return;
  }
  const updateManager = uni.getUpdateManager();
  updateManager.onCheckForUpdate((res) => {
    if (res.hasUpdate) {
      updateManager.onUpdateReady(() => {
        uni.showModal({
          title: '更新提示',
          content: '新版本已经准备好，是否重启应用？',
          success: (modalResult) => {
            if (modalResult.confirm) {
              updateManager.applyUpdate();
            }
          },
        });
      });
      return;
    }
    if (!silence) {
      uni.showModal({
        title: '当前为最新版本',
        showCancel: false,
      });
    }
  });
};

async function getSubscribeTemplate() {
  const { code, data } = await SocialApi.getSubscribeTemplateList();
  if (code === 0) {
    subscribeEventList = data;
  }
}

function subscribeMessage(event, callback = undefined) {
  const events = typeof event === 'string' ? [event] : event;
  if (!Array.isArray(events)) {
    return;
  }
  const tmplIds = events
    .map((name) => subscribeEventList.find((item) => item.title.includes(name))?.id)
    .filter(Boolean);
  if (tmplIds.length === 0) {
    return;
  }
  uni.requestSubscribeMessage({
    tmplIds,
    success: () => callback && callback(),
    fail: (error) => console.log(error),
  });
}

function requestMerchantTransfer(mchId, packageInfo, successCallback, failCallback) {
  if (!wx.canIUse('requestMerchantTransfer')) {
    wx.showModal({
      content: '你的微信版本过低，请更新至最新版本。',
      showCancel: false,
    });
    return;
  }
  wx.requestMerchantTransfer({
    mchId,
    appId: wx.getAccountInfoSync().miniProgram.appId,
    package: packageInfo,
    success: (res) => {
      console.log('success:', res);
      successCallback && successCallback(res);
    },
    fail: (res) => {
      console.log('fail:', res);
      sheep.$helper.toast(res.errMsg);
      failCallback && failCallback(res);
    },
  });
}

export default {
  load,
  getOpenid,
  subscribeMessage,
  checkUpdate,
  requestMerchantTransfer,
};
