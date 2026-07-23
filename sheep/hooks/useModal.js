import $store from '@/sheep/store';
import { createAuthNavigationGate } from '@/pages/auth/auth-navigation.mjs';

const openMemberAuth = createAuthNavigationGate({
  getPages: () => getCurrentPages(),
  navigateTo: (options) => uni.navigateTo(options),
});

// 短剧会员只有一个身份入口：邀请制手机号登录与注册页面。
export function showAuthPage(mode = 'login') {
  return openMemberAuth(mode);
}

export function markAuthPageReady() {
  openMemberAuth.markReady();
}

export function showAuthModal() {
  return showAuthPage('login');
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
