import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

async function loadPresentationState() {
  const source = read('pages/drama/services/native-player-presentation.js');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

test('native player presentation converges when Activity returns before launch ACK', async () => {
  const { transitionNativePlayerPhase } = await loadPresentationState();

  let phase = transitionNativePlayerPhase('IDLE', 'LAUNCH');
  phase = transitionNativePlayerPhase(phase, 'RETURN');
  phase = transitionNativePlayerPhase(phase, 'ACK');

  assert.equal(phase, 'RETURNED');
});

test('native player presentation returns to an explicit retry state after a normal ACK', async () => {
  const { nativePlayerPlaceholderCopy, transitionNativePlayerPhase } =
    await loadPresentationState();

  let phase = transitionNativePlayerPhase('IDLE', 'LAUNCH');
  phase = transitionNativePlayerPhase(phase, 'ACK');
  assert.equal(phase, 'PRESENTED');
  phase = transitionNativePlayerPhase(phase, 'RETURN');
  assert.equal(phase, 'RETURNED');
  assert.deepEqual(nativePlayerPlaceholderCopy(true, phase), {
    title: '播放器已返回',
    description: '点击下方重新打开',
  });
});

test('native player placeholder never equates SDK capability with active loading', async () => {
  const { nativePlayerPlaceholderCopy } = await loadPresentationState();

  assert.deepEqual(nativePlayerPlaceholderCopy(true, 'IDLE'), {
    title: '原生播放器可用',
    description: '点击下方开始播放',
  });
  assert.deepEqual(nativePlayerPlaceholderCopy(false, 'IDLE'), {
    title: '当前剧集暂不可播放',
    description: '请稍后再试',
  });
});

test('drama page wires launch, ACK, return, failure, and reset transitions', () => {
  const page = read('pages/drama/play.vue');
  const playerFlow = page.slice(
    page.indexOf('async function playCurrentEpisode'),
    page.indexOf('function chooseEpisode'),
  );
  const catchStart = playerFlow.indexOf('} catch (error) {');
  const staleReturn = playerFlow.indexOf(
    "return { skipped: true, reason: 'stale-page-context' }",
    catchStart,
  );
  const failureTransition = playerFlow.indexOf("'FAIL'", catchStart);

  assert.match(
    page,
    /nativePlayerPhase\.value = transitionNativePlayerPhase\([\s\S]*?'LAUNCH'/,
  );
  assert.match(
    page,
    /opened\?\.opened[\s\S]*?transitionNativePlayerPhase\([\s\S]*?'ACK'/,
  );
  assert.match(page, /onShow\([\s\S]*?transitionNativePlayerPhase\([\s\S]*?'RETURN'/);
  assert.match(
    page,
    /watch\(currentEpisode[\s\S]*?transitionNativePlayerPhase\([\s\S]*?'RESET'/,
  );
  assert.ok(
    catchStart !== -1 && staleReturn !== -1 && failureTransition > staleReturn,
    'a stale player failure must return before it can mutate the current presentation phase',
  );
});
