import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('drama pages contain no bundled pseudo catalog or pseudo hot-search data', () => {
  const dramaData = read('pages/drama/data.js');
  const pangleContent = read('pages/drama/services/pangle-content.js');
  const homePage = read('pages/index/index.vue');
  const theaterPage = read('pages/index/category.vue');
  const hotPage = read('pages/drama/hot.vue');
  const searchPage = read('pages/index/search.vue');
  const profilePage = read('pages/index/user.vue');
  const routes = read('pages.json');
  const playPage = read('pages/drama/play.vue');
  const followPage = read('pages/drama/follow.vue');
  const aboutPage = read('pages/drama/about.vue');

  assert.doesNotMatch(dramaData, /export const DRAMAS|makeEpisodes\(/);
  assert.doesNotMatch(dramaData, /重生后我在商界封神|闪婚后总裁每天求公开|夜城十二点/);
  assert.doesNotMatch(homePage, /\bDRAMAS\b|VITE_DRAMA_REAL_CONTENT_REQUIRED/);
  assert.doesNotMatch(theaterPage, /\bDRAMAS\b|VITE_DRAMA_REAL_CONTENT_REQUIRED/);
  assert.doesNotMatch(hotPage, /\bDRAMAS\b|VITE_DRAMA_REAL_CONTENT_REQUIRED/);
  assert.doesNotMatch(searchPage, /\bDRAMAS\b|VITE_DRAMA_REAL_CONTENT_REQUIRED/);
  assert.doesNotMatch(searchPage, /const hotKeywords = \[[^\]]/);
  assert.doesNotMatch(pangleContent, /'热门短剧'|'内容更新中'|'9\.0'/);
  assert.doesNotMatch(profilePage, /VIP 权益|goVip/);
  assert.doesNotMatch(routes, /"path":\s*"vip"/);
  assert.equal(existsSync(resolve(root, 'pages/drama/vip.vue')), false);
  assert.doesNotMatch(playPage, /分享暂不可用|@tap="shareDrama"|function shareDrama/);
  assert.doesNotMatch(followPage, /同步参考项目/);
  assert.doesNotMatch(
    aboutPage,
    /用户协议|隐私政策|收集个人信息明示清单|个人信息第三方共享清单|v2026\.06/,
  );
  assert.match(aboutPage, /getAppBaseInfo/);
  assert.match(homePage, /真实剧单加载失败/);
  assert.match(searchPage, /getExternalDramas\(\)/);
});

test('the checked-in debug runtime bundle contains only the current real-data routes', () => {
  const assetsRoot = resolve(root, 'android-djx-runtime/static-www/assets');
  const assetNames = readdirSync(assetsRoot).filter((name) => name.endsWith('.js'));
  const bundle = assetNames
    .map((name) => readFileSync(resolve(assetsRoot, name), 'utf8'))
    .join('\n');
  const pageChunk = (prefix) =>
    assetNames
      .filter((name) => name.startsWith(prefix))
      .map((name) => readFileSync(resolve(assetsRoot, name), 'utf8'))
      .join('\n');

  assert.doesNotMatch(
    bundle,
    /重生后我在商界封神|闪婚后总裁每天求公开|夜城十二点/,
  );
  assert.doesNotMatch(bundle, /\["重生","甜宠","商战","悬疑","古装"\]/);
  assert.doesNotMatch(bundle, /\/member\/sign-in\/|\/member\/point\//);
  assert.doesNotMatch(
    bundle,
    /pages-drama-vip|VIP 权益|会员定价、支付和免广告策略后续接入真实后端/,
  );
  assert.doesNotMatch(pageChunk('pages-drama-play.'), /分享暂不可用/);
  assert.doesNotMatch(pageChunk('pages-drama-follow.'), /同步参考项目/);
  assert.doesNotMatch(
    pageChunk('pages-drama-about.'),
    /用户协议|隐私政策|收集个人信息明示清单|个人信息第三方共享清单|v2026\.06/,
  );
  assert.match(bundle, /skit_drama_member_scope_v1/);
  assert.match(bundle, /\/skit\/member\/check-ins/);
  assert.match(bundle, /\/skit\/member\/point-records/);
});
