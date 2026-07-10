const getSafeArea = () => {
  const width = typeof window === 'undefined' ? 375 : window.innerWidth;
  const height = typeof window === 'undefined' ? 667 : window.innerHeight;
  return {
    left: 0,
    right: width,
    top: 0,
    bottom: height,
    width,
    height,
  };
};

const fallbackUni = {
  getWindowInfo() {
    const safeArea = getSafeArea();
    return {
      windowWidth: safeArea.width,
      windowHeight: safeArea.height,
      screenWidth: safeArea.width,
      screenHeight: safeArea.height,
      statusBarHeight: 0,
      safeArea,
      safeAreaInsets: {},
      pixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    };
  },
  getDeviceInfo() {
    return {
      platform: 'web',
      deviceBrand: 'browser',
      deviceModel: 'browser',
    };
  },
  getSystemInfoSync() {
    return this.getWindowInfo();
  },
  getAppBaseInfo() {
    return {
      uniPlatform: 'web',
    };
  },
  getStorageSync(key) {
    if (typeof localStorage === 'undefined') return '';
    try {
      const value = localStorage.getItem(key);
      return value === null ? '' : JSON.parse(value);
    } catch (e) {
      return localStorage.getItem(key) || '';
    }
  },
  setStorageSync(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      localStorage.setItem(key, String(value));
    }
  },
  removeStorageSync(key) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
  showToast(options = {}) {
    if (options.title) console.log(options.title);
  },
  hideTabBar(options = {}) {
    if (typeof options.fail === 'function') options.fail();
  },
  getClipboardData(options = {}) {
    if (typeof options.success === 'function') options.success({ data: '' });
  },
  getNetworkType() {
    return Promise.resolve({
      networkType: typeof navigator !== 'undefined' && navigator.onLine === false ? 'none' : 'wifi',
    });
  },
  getMenuButtonBoundingClientRect() {
    return null;
  },
  upx2px(value) {
    const width = typeof window === 'undefined' ? 375 : window.innerWidth;
    return Number(value) * width / 750;
  },
};

const bindValue = (target, value) => {
  return typeof value === 'function' ? value.bind(target) : value;
};

export const getUni = () => {
  if (typeof uni === 'undefined') return fallbackUni;

  return new Proxy(fallbackUni, {
    get(target, prop) {
      const nativeValue = uni[prop];
      if (nativeValue !== undefined && nativeValue !== null) {
        return bindValue(uni, nativeValue);
      }
      return bindValue(target, target[prop]);
    },
  });
};

export default getUni();
