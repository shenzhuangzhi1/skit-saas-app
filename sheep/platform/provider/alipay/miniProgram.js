import SocialApi from '@/sheep/api/member/social';

let subscribeEventList = [];

function load() {
  checkUpdate();
  getSubscribeTemplate();
}

async function getOpenid() {
  return uni.getStorageSync('openid') || '';
}

const checkUpdate = (silence = true) => {
  if (!uni.canIUse('getUpdateManager')) {
    if (!silence) {
      uni.showToast({ title: '当前为最新版本', icon: 'none' });
    }
    return;
  }
  const updateManager = uni.getUpdateManager();
  updateManager.onCheckForUpdate((res) => {
    if (!res.hasUpdate) {
      return;
    }
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

export default {
  load,
  getOpenid,
  subscribeMessage,
  checkUpdate,
};
