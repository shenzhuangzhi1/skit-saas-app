import $store from '@/sheep/store';

// 短剧会员只有一个身份入口：邀请制手机号登录与注册页面。
export function showAuthModal() {
  const pages = getCurrentPages();
  const currentRoute = pages[pages.length - 1]?.route || '';
  if (currentRoute !== 'pages/auth/index') {
    uni.navigateTo({ url: '/pages/auth/index?mode=login' });
  }
}

// 打开分享弹框
export function showShareModal() {
  $store('modal').$patch((state) => {
    state.share = true;
  });
}

// 关闭分享弹框
export function closeShareModal() {
  $store('modal').$patch((state) => {
    state.share = false;
  });
}

// 打开快捷菜单
export function showMenuTools() {
  $store('modal').$patch((state) => {
    state.menu = true;
  });
}

// 关闭快捷菜单
export function closeMenuTools() {
  $store('modal').$patch((state) => {
    state.menu = false;
  });
}

// 记录广告弹框历史
export function saveAdvHistory(adv) {
  const modal = $store('modal');

  modal.$patch((state) => {
    if (!state.advHistory.includes(adv.imgUrl)) {
      state.advHistory.push(adv.imgUrl);
    }
  });
}
