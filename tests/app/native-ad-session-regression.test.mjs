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

test('native player polls in-flight or verifying sessions without starting another Taku ad', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const apiClient = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java',
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

  const reusedStart = createFlow.indexOf(
    '"REUSED".equals(result.getOutcome())\n                                || "VERIFYING".equals(result.getOutcome())',
  );
  const createdStart = createFlow.indexOf('"CREATED".equals(result.getOutcome())');
  assert.notEqual(
    reusedStart,
    -1,
    'REUSED and VERIFYING must share a poll-only native outcome branch',
  );
  assert.notEqual(createdStart, -1, 'CREATED must have its own native outcome branch');

  const reusedBranch = createFlow.slice(reusedStart, createdStart);
  assert.match(reusedBranch, /scheduleNextPoll\(/);
  assert.doesNotMatch(reusedBranch, /takuRewardedAdController\.start\(/);
  assert.match(createFlow.slice(createdStart), /takuRewardedAdController\.start\(/);
  assert.match(
    apiClient,
    /!"CREATED"\.equals\(outcome\)\s*&&\s*!"REUSED"\.equals\(outcome\)\s*&&\s*!"VERIFYING"\.equals\(outcome\)/,
    'native API parser must accept the server settlement-pending outcome',
  );
  assert.match(
    apiClient,
    /"VERIFYING"\.equals\(outcome\)[\s\S]*?new CreateResult\(outcome, null, sessionId\)/,
    'VERIFYING must create a poll-only reference without inventing an ad token',
  );
  assert.match(createFlow, /activeSessionId = result\.getSessionId\(\)/);
  assert.match(reusedBranch, /activeSessionId/);
});

test('native player replaces a terminal orphaned poll-only session once in the same unlock flow', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const apiClient = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java',
  );
  const pollFlow = between(
    player,
    'private void pollServerReward',
    'private void verifyAuthoritativeEpisodeEntitlement',
  );

  assert.match(apiClient, /private final String clientLifecycleStatus/);
  assert.match(apiClient, /String getClientLifecycleStatus\(\)/);
  assert.match(
    apiClient,
    /data\.optString\("clientLifecycleStatus", ""\)[\s\S]*?CLIENT_LIFECYCLE_STATUS/,
  );
  assert.match(
    player,
    /"REUSED"\.equals\(result\.getOutcome\(\)\)[\s\S]*?activeSessionPollOnly = true/,
  );
  assert.match(
    pollFlow,
    /serverShowId == null[\s\S]*?retryExpiredPollOnlySession\([\s\S]*?return/,
  );
  assert.match(
    player,
    /private boolean retryExpiredPollOnlySession[\s\S]*?consumeIfRecoverable\([\s\S]*?status\.getClientLifecycleStatus\(\)[\s\S]*?status\.getRewardVerificationStatus\(\)[\s\S]*?status\.getProviderShowId\(\)[\s\S]*?activeSessionId = null[\s\S]*?createServerAdSession\(targetEpisode, generation\)[\s\S]*?return true/,
  );
  assert.match(player, /adSessionRecoveryPolicy\.begin\(unlockGeneration\)/);
  assert.match(player, /adSessionRecoveryPolicy\.cancel\(unlockGeneration\)/);
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
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const playbackEvidence = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/ad/PlaybackEvidenceScope.java',
  );
  const contentBridge = read('pages/drama/services/pangle-content.js');
  const page = read('pages/drama/play.vue');

  assert.match(verifier, /const initialTopActivity = await getTopActivity\(\)/);
  assert.match(
    verifier,
    /verifyRewardChain && initialTopActivity === playerActivity[\s\S]*?throw new Error/,
  );
  assert.match(verifier, /let rewardClickPerformed = false/);
  assert.match(verifier, /let rewardEvidenceDeadline = 0/);
  assert.match(verifier, /rewardClickPerformed = true/);
  assert.match(verifier, /rewardEvidenceDeadline = Date\.now\(\) \+ 240000/);
  assert.match(verifier, /await waitFor\([\s\S]*?assertFreshRewardChainEvidence\([\s\S]*?rewardEvidenceDeadline - Date\.now\(\)/);
  assert.match(verifier, /Target player request failed[\s\S]*?'FAILED'/);
  assert.doesNotMatch(verifier, /Promise\.allSettled\(\[\.\.\.responseReads\]\)/);
  assert.match(verifier, /assertFreshRewardChainEvidence\(/);
  assert.match(verifier, /evidenceRunId/);
  assert.match(verifier, /memberExchanges/);
  assert.match(controller, /TAKU_TELEMETRY state=/);
  assert.match(controller, /sessionRef=/);
  assert.match(controller, /SafeEvidenceReference\.of\(telemetry\.getProtocol\(\)\.getSessionId\(\)\)/);
  assert.match(controller, /showRef=/);
  assert.match(controller, /SafeEvidenceReference\.of\(telemetry\.getProviderShowId\(\)\)/);
  assert.match(player, /onDJXVideoPlay\(Map<String, Object> extra\)/);
  assert.match(player, /matchesTargetVideo\(extra\)/);
  assert.match(player, /playbackEvidenceScope\.playingEvidence\(\)/);
  assert.match(player, /playbackEvidenceScope\.requestFailureEvidence\(code\)/);
  assert.match(
    player,
    /onDJXRequestFail[\s\S]*?if \(!targetPlaybackLogged[\s\S]*?matchesTargetVideo\(extra\)\)/,
  );
  assert.match(playbackEvidence, /PLAYER_PLAYING dramaId=/);
  assert.match(playbackEvidence, /PLAYER_REQUEST_FAILED dramaId=/);
  assert.match(player, /launchSessionRef/);
  assert.match(player, /launchShowRef/);
  assert.match(contentBridge, /rewardEvidence/);
  assert.match(page, /const unlockEpisode = currentEpisode\.value/);
  assert.match(page, /episodeNo:\s*unlockEpisode/);
  assert.match(page, /grantedEpisodeNos\.includes\(unlockEpisode\)/);
  assert.match(page, /currentEpisode\.value !== unlockEpisode/);
  assert.match(
    page,
    /server_verified_reward[\s\S]*?episodeNo:\s*unlockEpisode[\s\S]*?sessionId:\s*result\.status\.sessionId[\s\S]*?providerShowId:\s*result\.status\.providerShowId[\s\S]*?unlockEpisode/,
  );
});

test('DJX skips its duplicate confirmation but only completes with signed server provenance', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const api = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java',
  );
  const scope = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/ad/PlaybackEvidenceScope.java',
  );

  assert.match(player, /\.hideRewardDialog\(true\)/);
  assert.match(api, /getVerifiedRewardProvenance\(/);
  assert.match(api, /\/entitlements\/" \+ episodeNo\s*\+ "\/reward-provenance/);
  assert.match(player, /completeWithVerifiedRewardProvenance[\s\S]*?getVerifiedRewardProvenance/);
  assert.match(player, /matchesLaunchRewardEvidence\(targetEpisode, proof\)/);
  assert.match(scope, /matchesVerifiedReward\(String sessionId, String providerShowId\)/);
  assert.match(player, /activeUnlockCallback\.onShow\(evidence\.getProviderShowId\(\)\)/);
  assert.match(player, /callback\.onRewardVerify\(new DJXRewardAdResult\(true, rewardPayload\)\)/);
  assert.ok(
    player.indexOf('activeUnlockCallback.onShow(evidence.getProviderShowId())')
      < player.indexOf('callback.onRewardVerify(new DJXRewardAdResult(true, rewardPayload))'),
    'the real show identity must be reported before DJX reward verification',
  );
  assert.doesNotMatch(player, /onShow\(launchShowRef\)/);
  assert.doesNotMatch(player, /server-entitlement/);
});
