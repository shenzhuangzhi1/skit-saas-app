import { defineStore } from 'pinia';

const modal = defineStore('modal', {
  state: () => ({
    share: false, // 分享弹框
    menu: false, // 快捷菜单弹框
    advHistory: [], // 广告弹框记录
  }),
  persist: {
    enabled: true,
    strategies: [
      {
        key: 'modal-store',
        paths: ['advHistory'],
      },
    ],
  },
});

export default modal;
