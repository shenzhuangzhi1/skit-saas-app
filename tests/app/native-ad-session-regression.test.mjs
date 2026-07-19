import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('native player polls REUSED sessions without starting another Taku ad', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const createFlow = between(
    player,
    'private void createServerAdSession',
    'private void onTakuTelemetry',
  );

  assert.match(
    createFlow,
    /"ALREADY_ENTITLED"\.equals\(result\.getOutcome\(\)\)[\s\S]*?verifyAuthoritativeEpisodeEntitlement/,
  );

  const reusedStart = createFlow.indexOf('"REUSED".equals(result.getOutcome())');
  const createdStart = createFlow.indexOf('"CREATED".equals(result.getOutcome())');
  assert.notEqual(reusedStart, -1, 'REUSED must have its own native outcome branch');
  assert.notEqual(createdStart, -1, 'CREATED must have its own native outcome branch');

  const reusedBranch = createFlow.slice(reusedStart, createdStart);
  assert.match(reusedBranch, /scheduleNextPoll\(/);
  assert.doesNotMatch(reusedBranch, /takuRewardedAdController\.start\(/);
  assert.match(createFlow.slice(createdStart), /takuRewardedAdController\.start\(/);
});

test('native Taku bridge terminates callbacks on protocol or startup errors', () => {
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );
  const messageFlow = between(
    bridge,
    'private void handleMessage',
    'private void showRewardedVideo',
  );
  const showFlow = between(
    bridge,
    'private void showRewardedVideo',
    'private AdSessionProtocol parseProtocol',
  );

  assert.match(
    messageFlow,
    /catch \(Throwable error\)[\s\S]*?emitTerminalError\(callbackId, protocol\)/,
  );
  assert.match(
    showFlow,
    /catch \(Throwable error\)[\s\S]*?emitTerminalError\(id, protocol\)/,
  );
  assert.match(
    bridge,
    /private void emitTerminalError[\s\S]*?TakuNativeState\.ERROR[\s\S]*?emit\(id, result, true\)/,
  );
});

test('native player records a synchronous Taku startup failure before releasing the unlock', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const createFlow = between(
    player,
    'private void createServerAdSession',
    'private void onTakuTelemetry',
  );

  assert.match(
    createFlow,
    /catch \(Throwable startFailure\)[\s\S]*?recordSynchronousTakuStartFailure\(startFailure\)/,
  );
  assert.match(
    player,
    /private void recordSynchronousTakuStartFailure[\s\S]*?TakuSessionStateMachine[\s\S]*?machine\.failed\(null, null, null\)[\s\S]*?onTakuTelemetry/,
  );
});

test('reward-chain verifier delegates to structured evidence correlation', () => {
  const verifier = read('scripts/verify-android-player.mjs');
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuRewardedAdController.java',
  );

  assert.match(verifier, /const initialTopActivity = await getTopActivity\(\)/);
  assert.match(
    verifier,
    /verifyRewardChain && initialTopActivity === playerActivity[\s\S]*?throw new Error/,
  );
  assert.match(verifier, /let rewardClickPerformed = false/);
  assert.match(verifier, /rewardClickPerformed = true/);
  assert.match(verifier, /assertFreshRewardChainEvidence\(/);
  assert.match(verifier, /evidenceRunId/);
  assert.match(verifier, /memberExchanges/);
  assert.match(controller, /TAKU_TELEMETRY state=/);
  assert.match(controller, /showRef=/);
  assert.match(controller, /showReference\(telemetry\.getProviderShowId\(\)\)/);
});
