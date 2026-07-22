import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const customerSources = [
  'pages/index/index.vue',
  'pages/index/category.vue',
  'pages/drama/hot.vue',
  'pages/drama/play.vue',
  'pages/drama/services/pangle-content.js',
  'pages/drama/services/taku-reward-ad.js',
];

test('customer-facing drama and ad copy does not expose supplier names', () => {
  for (const source of customerSources) {
    assert.doesNotMatch(read(source), /穿山甲|Taku 激励视频|Taku 原生/);
  }
  const player = read('pages/drama/play.vue');
  assert.match(player, /开始播放/);
  assert.match(player, /看广告解锁/);
  assert.match(player, /当前广告库存不足，请稍后再试/);
  assert.match(player, /error\?\.code === 'PRIVACY_CONSENT_REQUIRED'/);
  assert.match(player, /请先同意隐私与广告服务后再观看广告/);
  assert.match(player, /error\?\.code === 'PANGLE_INIT_FAILED'/);
  assert.match(player, /内容与广告服务初始化失败，请重启应用后重试/);
  assert.match(player, /error\?\.code === 'TAKU_INIT_FAILED'/);
  assert.match(player, /广告服务初始化失败，请稍后重试/);
  assert.match(player, /Number\(error\?\.code\) === 1030007008/);
  assert.match(player, /Number\(error\?\.code\) === 1030007009/);
  assert.match(player, /当前剧目正在准备，请稍后重试/);
  assert.match(player, /Number\(error\?\.code\) === 1030007010/);
  assert.match(player, /当前代理商内容授权未配置，请联系代理商/);
  assert.match(player, /Number\(error\?\.code\) === 1030007011/);
  assert.match(player, /当前剧目不在本代理商内容库，请选择其他剧目/);
  assert.match(player, /Number\(error\?\.code\) === 1030007012/);
  assert.match(player, /当前代理商内容授权失效，请联系代理商/);
  assert.doesNotMatch(
    player,
    /当前租户|测试名单|广告能力|APK 版本|服务端验奖|奖励验证|广告会话|权益同步/,
  );
});
