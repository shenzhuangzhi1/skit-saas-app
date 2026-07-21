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
  assert.doesNotMatch(
    player,
    /当前租户|测试名单|广告能力|APK 版本|服务端验奖|奖励验证|广告会话|权益同步/,
  );
});
