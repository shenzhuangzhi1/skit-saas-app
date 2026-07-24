import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('runtime system-bar query values are validated and merged into H5 window info', async () => {
  const moduleUrl = pathToFileURL(resolve(root, 'sheep/helper/system-bars.mjs'));
  moduleUrl.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  const { mergeRuntimeSystemBars, parseRuntimeSystemBars } = await import(moduleUrl.href);

  assert.deepEqual(parseRuntimeSystemBars('?skitTopInset=34&skitBottomInset=16'), {
    top: 34,
    bottom: 16,
  });
  assert.deepEqual(parseRuntimeSystemBars('?skitTopInset=-1&skitBottomInset=9999'), {
    top: 0,
    bottom: 0,
  });

  const merged = mergeRuntimeSystemBars(
    {
      windowWidth: 360,
      windowHeight: 820,
      statusBarHeight: 0,
      safeArea: { left: 0, right: 360, top: 0, bottom: 820, width: 360, height: 820 },
      safeAreaInsets: {},
    },
    { top: 34, bottom: 16 },
  );

  assert.equal(merged.statusBarHeight, 34);
  assert.deepEqual(merged.safeAreaInsets, { top: 34, bottom: 16, left: 0, right: 0 });
  assert.equal(merged.safeArea.top, 34);
  assert.equal(merged.safeArea.bottom, 804);
  assert.equal(merged.safeArea.height, 770);

  const nativeTopWins = mergeRuntimeSystemBars(
    {
      windowWidth: 360,
      windowHeight: 820,
      statusBarHeight: 0,
      safeAreaInsets: { top: 40 },
    },
    { top: 34, bottom: 0 },
  );
  assert.equal(nativeTopWins.statusBarHeight, 40);
  assert.equal(nativeTopWins.safeAreaInsets.top, 40);
});

test('Android shell publishes real system-bar dimensions before loading the H5 app', () => {
  const activity = readFileSync(
    resolve(
      root,
      'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/MainActivity.java',
    ),
    'utf8',
  );
  const helper = readFileSync(resolve(root, 'sheep/helper/uni.js'), 'utf8');

  assert.match(activity, /systemBarHeightDp\("status_bar_height"\)/);
  assert.match(activity, /systemBarHeightDp\("navigation_bar_height"\)/);
  assert.match(activity, /appendQueryParameter\("skitTopInset"/);
  assert.match(activity, /appendQueryParameter\("skitBottomInset"/);
  assert.match(
    activity,
    /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.VANILLA_ICE_CREAM[\s\S]*?return 0;/,
  );
  assert.match(helper, /mergeRuntimeSystemBars/);
  assert.match(helper, /getWindowInfo/);
  assert.match(helper, /getSystemInfoSync/);
});
