const AUTH_ROUTE = 'pages/auth/index';
const PROFILE_TAB = '/pages/index/user';

function routeOf(page) {
  return String(page?.route || page?.$page?.route || '')
    .replace(/^\/+/, '')
    .split('?')[0];
}

export function resolveAuthExit(pages = []) {
  let delta = 0;
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    if (routeOf(pages[index]) !== AUTH_ROUTE) {
      break;
    }
    delta += 1;
  }
  if (delta > 0 && pages.length > delta) {
    return { action: 'back', delta };
  }
  return { action: 'tab', url: PROFILE_TAB };
}

export function createAuthNavigationGate({ getPages, navigateTo }) {
  let pending = false;
  return function openMemberLogin() {
    const pages = getPages() || [];
    if (pending || routeOf(pages[pages.length - 1]) === AUTH_ROUTE) {
      return false;
    }
    pending = true;
    try {
      navigateTo({
        url: `/${AUTH_ROUTE}?mode=login`,
        complete() {
          pending = false;
        },
      });
      return true;
    } catch (error) {
      pending = false;
      throw error;
    }
  };
}
