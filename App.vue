<script setup>
  import { onLaunch, onShow, onError } from '@dcloudio/uni-app';
  import sheep, { ShoproInit } from './sheep';
  import safeUni from './sheep/helper/uni';
  import { checkAndInstallUpdate } from './sheep/services/app-update';
  import { recoverPendingAdSessions } from './pages/drama/services/ad-session-runtime';

  const builtAgentCode = String(import.meta.env?.VITE_SKIT_AGENT_CODE || '')
    .trim()
    .toUpperCase();

  function scheduleHotUpdateCheck() {
    setTimeout(() => {
      checkAndInstallUpdate({ profileCode: builtAgentCode }).catch((error) => {
        console.warn('[app-update] check failed; current bundle remains active', error);
      });
    }, 700);
  }

  function resumePendingAdVerification() {
    const userStore = sheep.$store('user');
    const profile = userStore.userInfo || {};
    const memberId = profile.userId ?? profile.id;
    if (!userStore.isLogin || profile.tenantId === undefined || memberId === undefined) {
      return;
    }
    recoverPendingAdSessions(
      { tenantId: profile.tenantId, memberId },
      {
        onResult(result) {
          if (result.resolution !== 'GRANTED') {
            return;
          }
          safeUni.showToast({ title: '广告奖励已通过服务端验证', icon: 'none' });
        },
      },
    ).catch((error) => {
      console.warn('[ad-session] foreground recovery unavailable', error?.message || error);
    });
  }

  onLaunch(() => {
    // 隐藏原生导航栏 使用自定义底部导航
    safeUni.hideTabBar({
      fail: () => {},
    });

    // 加载Shopro底层依赖
    ShoproInit();
  });

  onShow(() => {
    scheduleHotUpdateCheck();
    resumePendingAdVerification();
    // #ifdef APP-PLUS
    // 获取urlSchemes参数
    const args = plus.runtime.arguments;
    if (args) {
    }

    // 获取剪贴板
    safeUni.getClipboardData({
      success: (res) => {},
    });
    // #endif
  });
</script>

<style lang="scss">
  @import '@/sheep/scss/index.scss';
</style>
