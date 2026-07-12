<script setup>
  import { onLaunch, onShow, onError } from '@dcloudio/uni-app';
  import { ShoproInit } from './sheep';
  import safeUni from './sheep/helper/uni';
  import { checkAndInstallUpdate } from './sheep/services/app-update';

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
