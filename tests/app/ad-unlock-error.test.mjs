import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function loadUnlockError() {
  try {
    return await import(
      pathToFileURL(resolve(root, 'pages/drama/services/ad-unlock-error.mjs')).href
    );
  } catch {
    return {};
  }
}

test('only native-ad failures use the unavailable-ad message', async () => {
  const { rewardErrorTitle } = await loadUnlockError();

  assert.equal(typeof rewardErrorTitle, 'function', 'unlock error classifier must exist');
  assert.equal(rewardErrorTitle({ code: 'NATIVE_AD_UNAVAILABLE' }), '广告暂不可用，请稍后重试');
  assert.equal(rewardErrorTitle({ code: 'NATIVE_AD_NO_FILL' }), '当前广告库存不足，请稍后再试');
  assert.equal(rewardErrorTitle({ code: 'AUTH_SESSION_STALE' }), '登录状态同步中，请稍后重试');
  assert.equal(rewardErrorTitle({ code: 'AUTH_SESSION_UNVERIFIED' }), '登录状态同步中，请稍后重试');
  assert.equal(
    rewardErrorTitle({ code: 401, msg: '您的登录已过期' }),
    '登录状态同步中，请稍后重试',
  );
  assert.equal(
    rewardErrorTitle({ statusCode: 403, msg: '拒绝访问' }),
    '当前账号暂无观看权限，请稍后重试',
  );
  assert.equal(
    rewardErrorTitle(new Error('服务端权益尚未同步，请稍后重试')),
    '服务暂时繁忙，请稍后重试',
  );
  assert.equal(rewardErrorTitle({ statusCode: 500 }), '服务暂时繁忙，请稍后重试');
});

test('unlock diagnostics contain only a bounded stage and safe code', async () => {
  const { formatUnlockFailure } = await loadUnlockError();

  assert.equal(typeof formatUnlockFailure, 'function', 'safe unlock logger must exist');
  assert.equal(
    formatUnlockFailure({
      stage: 'session',
      error: { code: 'AUTH_SESSION_STALE', message: 'token=secret&mobile=13800000000' },
    }),
    '[ad-unlock] stage=session code=AUTH_SESSION_STALE',
  );
  assert.equal(
    formatUnlockFailure({
      stage: 'session token=secret',
      error: { code: 'BAD code token=secret' },
    }),
    '[ad-unlock] stage=unknown code=UNKNOWN',
  );
  assert.equal(
    formatUnlockFailure({ stage: 'identity', error: { code: '13800000000' } }),
    '[ad-unlock] stage=identity code=UNKNOWN',
  );
  assert.equal(
    formatUnlockFailure({ stage: 'native', error: { code: 'AUTH_SECRET_TOKEN_ABC123' } }),
    '[ad-unlock] stage=native code=UNKNOWN',
  );
});

test('the player logs a classified unlock failure instead of leaking raw errors', () => {
  const player = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');
  const unlockStart = player.indexOf('async function unlockCurrent()');
  const unlockEnd = player.indexOf('\n  function ', unlockStart + 1);
  const unlockFlow = player.slice(unlockStart, unlockEnd);

  assert.match(
    player,
    /import \{\s*formatUnlockFailure,\s*rewardErrorTitle,\s*\} from '@\/pages\/drama\/services\/ad-unlock-error\.mjs'/,
  );
  assert.match(unlockFlow, /let unlockStage = 'identity'/);
  assert.match(
    unlockFlow,
    /console\.warn\(formatUnlockFailure\(\{ stage: unlockStage, error \}\)\)/,
  );
  assert.doesNotMatch(player, /function rewardErrorTitle\(error\)/);
});
