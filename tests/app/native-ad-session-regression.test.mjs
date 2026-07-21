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
  assert.match(pollFlow, /serverShowId == null[\s\S]*?retryExpiredPollOnlySession\([\s\S]*?return/);
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
  assert.match(showFlow, /catch \(Throwable error\)[\s\S]*?emitTerminalError\(id, protocol\)/);
  assert.match(
    bridge,
    /private void emitTerminalError[\s\S]*?TakuNativeState\.ERROR[\s\S]*?emit\(id, result, true, TakuFailureReason\.SDK_FAILURE\)/,
  );
});

test('native player ends an unrewarded close without entering reward verification polling', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  const telemetryFlow = between(
    player,
    'private void onTakuTelemetry',
    'private void afterTelemetryRecorded',
  );
  const terminalFlow = between(
    player,
    'private void afterTelemetryRecorded',
    'private void scheduleNextPoll',
  );

  const unrewardedDecision = telemetryFlow.indexOf(
    'telemetry.getState() == TakuNativeState.CLOSED\n                && !telemetry.isClientRewardObserved()',
  );
  const telemetryRecord = telemetryFlow.indexOf('nativeApiClient.recordTelemetry(telemetry');
  const releaseBranch = telemetryFlow.indexOf('if (unrewardedClose)', telemetryRecord);
  const deferredRelease = telemetryFlow.indexOf('handler.post(', releaseBranch);
  const failUnlock = telemetryFlow.indexOf('failActiveUnlock(', deferredRelease);
  const rewardedClosedBranch = terminalFlow.indexOf(
    'telemetry.getState() == TakuNativeState.CLOSED\n                && telemetry.isClientRewardObserved()',
  );
  const verificationPoll = terminalFlow.indexOf('scheduleNextPoll(', rewardedClosedBranch);

  assert.notEqual(
    unrewardedDecision,
    -1,
    'CLOSED telemetry must distinguish a close before the reward callback',
  );
  assert.notEqual(telemetryRecord, -1, 'the cancellation event must still be queued for telemetry');
  assert.notEqual(releaseBranch, -1, 'the cancellation decision must run after queuing telemetry');
  assert.notEqual(deferredRelease, -1, 'unlock release must run after the SDK callback unwinds');
  assert.notEqual(failUnlock, -1, 'an unrewarded close must release the active unlock');
  assert.match(
    telemetryFlow,
    /"广告未完整观看，请重新观看"/,
    'an unrewarded close must use the stable device-verification message',
  );
  assert.notEqual(
    rewardedClosedBranch,
    -1,
    'only a close with an observed reward may enter signed verification',
  );
  assert.notEqual(verificationPoll, -1, 'a rewarded close must retain signed-server polling');
  assert.ok(
    unrewardedDecision < telemetryRecord &&
      telemetryRecord < releaseBranch &&
      releaseBranch < deferredRelease &&
      deferredRelease < failUnlock,
    'the unrewarded close must be recorded and then released without waiting for HTTP',
  );
  assert.match(
    player,
    /NativeRewardGate\.Decision decision[\s\S]*?Decision\.GRANT[\s\S]*?verifyAuthoritativeEpisodeEntitlement/,
    'the cancellation fix must not weaken signed-server authorization',
  );
});

test('native Taku terminal fallback uses cached show identity instead of reparsing bad adInfo', () => {
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuRewardedAdController.java',
  );
  const failureFlow = between(controller, 'private void fail', 'private boolean isActive');

  assert.doesNotMatch(
    failureFlow,
    /ATAdInfo|showId\(adInfo\)|networkFirmId\(adInfo\)|adsourceId\(adInfo\)/,
    'terminal fallback must not parse the same invalid SDK callback twice',
  );
  assert.match(
    failureFlow,
    /session\.machine\.failed\(\s*null, null, null, failureReason\)/,
    'the state machine must recover the already-bound show identity',
  );
  assert.equal(
    (failureFlow.match(/session\.machine\.failed/g) || []).length,
    1,
    'one native failure must create exactly one terminal telemetry event',
  );
  assert.equal(
    (failureFlow.match(/emit\(session, failure\)/g) || []).length,
    1,
    'one native failure must emit exactly one terminal telemetry event',
  );
});

test('native Taku bridge clears its pending callback even if terminal delivery throws', () => {
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );
  const showFlow = between(
    bridge,
    'private void showRewardedVideo',
    'private void emitTerminalError',
  );

  assert.match(
    showFlow,
    /try\s*\{\s*emit\(id, telemetryJson\(telemetry\), terminal, telemetry\.getFailureReason\(\)\);\s*\}\s*finally\s*\{[\s\S]*?terminal[\s\S]*?pendingCallbackId = null;/,
    'terminal callback ownership must be released in a finally block',
  );
});

test('native API shutdown drains queued terminal telemetry instead of cancelling it', () => {
  const api = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java',
  );
  const closeFlow = between(api, 'void close()', 'private <T> void execute');
  const executeFlow = between(api, 'private <T> void execute', 'private HttpUrl url');

  assert.match(
    closeFlow,
    /serialExecutor\.execute\([\s\S]*?connectionPool\(\)\.evictAll\(\)[\s\S]*?serialExecutor\.shutdown\(\)/,
    'close must enqueue cleanup behind already queued telemetry and then stop new work',
  );
  assert.doesNotMatch(
    closeFlow,
    /shutdownNow\(|cancelAll\(/,
    'Activity teardown must not interrupt a queued CLOSED event',
  );
  assert.match(
    executeFlow,
    /if \(!submitted\)[\s\S]*?callback::onFailure/,
    'requests arriving after graceful shutdown must fail without throwing on the UI thread',
  );
  assert.match(
    executeFlow,
    /catch \(RejectedExecutionException rejected\)[\s\S]*?if \(!submitted\)[\s\S]*?callback::onFailure/,
    'the execute/close race must fail safely instead of crashing the Activity',
  );
});

test('native terminal telemetry retries transient failures and close admission stays atomic', () => {
  const api = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitNativeApiClient.java',
  );
  const telemetryFlow = between(api, 'void recordTelemetry', 'void getSession');
  const closeFlow = between(api, 'void close()', 'private <T> void execute');
  const executeFlow = between(api, 'private <T> void execute', 'private HttpUrl url');

  assert.match(
    api,
    /TELEMETRY_MAX_ATTEMPTS\s*=\s*3/,
    'terminal telemetry must have a bounded retry budget',
  );
  assert.match(
    telemetryFlow,
    /execute\([\s\S]*?TELEMETRY_MAX_ATTEMPTS\)/,
    'client-event delivery must opt into the bounded retry path',
  );
  assert.match(
    executeFlow,
    /for \(int attempt = 1; attempt <= maxAttempts; attempt\+\+\)[\s\S]*?attempt < maxAttempts[\s\S]*?telemetryRetryDelayMillis/,
    'HTTP, application-envelope and parser failures must retry before final failure',
  );
  assert.match(
    executeFlow,
    /synchronized \(this\) \{[\s\S]*?if \(!closed\)[\s\S]*?serialExecutor\.execute/,
    'closed admission and executor submission must share one monitor',
  );
  assert.match(
    closeFlow,
    /synchronized \(this\) \{[\s\S]*?closed = true[\s\S]*?serialExecutor\.execute[\s\S]*?serialExecutor\.shutdown\(\)/,
    'close must enqueue cleanup and shutdown under the same admission monitor',
  );
  assert.match(
    executeFlow,
    /if \(!submitted\) \{\s*activity\.runOnUiThread\(callback::onFailure\);\s*\}/,
    'rejection callbacks must run after leaving the admission monitor',
  );
});

test('native pending-ad cancellation wins before show and emits one terminal event', () => {
  const controller = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/TakuRewardedAdController.java',
  );
  const bridge = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/SkitTakuAdBridge.java',
  );
  const runtime = read('android-djx-runtime/djx-runtime.js');
  const loadedFlow = between(
    controller,
    'public void onRewardedVideoAdLoaded()',
    'public void onRewardedVideoAdFailed',
  );
  const destroyFlow = between(controller, 'void destroy()', 'void cancelActiveSession()');

  assert.match(controller, /boolean cancelPendingSession\(\)/);
  assert.match(
    controller,
    /presentationLease\.cancelBeforeShow\(\)[\s\S]*?fail\(session, ad\)/,
    'a pending load cancellation must emit the normal ERROR terminal telemetry',
  );
  assert.match(
    loadedFlow,
    /canPresent\(session\)[\s\S]*?presentationLease\.requestShow\(\)[\s\S]*?ad\.show\(/,
    'the SDK callback must acquire the presentation lease before showing',
  );
  assert.match(
    controller,
    /activity\.hasWindowFocus\(\)/,
    'a background or covered host must not present a newly loaded ad',
  );
  assert.match(bridge, /"cancelRewardedVideo"\.equals\(method\)/);
  assert.match(
    bridge,
    /String presentationUrl = webView\.getUrl\(\)[\s\S]*?presentationUrl\.equals\(webView\.getUrl\(\)\)/,
    'a load started by an old H5 route must not show over a new route',
  );
  assert.match(runtime, /cancelRewardedVideo:\s*function/);
  assert.match(
    destroyFlow,
    /activeSession[\s\S]*?activeAd[\s\S]*?fail\(session, ad\)[\s\S]*?destroyed = true/,
    'Activity destruction must queue terminal failure before disabling callbacks',
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

test('native player distinguishes safe no-fill without exposing provider error text', () => {
  const player = read(
    'android-djx-runtime/app/src/main/java/top/neoshen/xingheyingguan/DramaPlayerActivity.java',
  );
  assert.match(
    player,
    /telemetry\.getFailureReason\(\) == TakuFailureReason\.NO_FILL[\s\S]*?当前广告库存不足，请稍后再试/,
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
  assert.match(
    verifier,
    /await waitFor\([\s\S]*?assertFreshRewardChainEvidence\([\s\S]*?rewardEvidenceDeadline - Date\.now\(\)/,
  );
  assert.match(verifier, /Target player request failed[\s\S]*?'FAILED'/);
  assert.doesNotMatch(verifier, /Promise\.allSettled\(\[\.\.\.responseReads\]\)/);
  assert.match(verifier, /assertFreshRewardChainEvidence\(/);
  assert.match(verifier, /evidenceRunId/);
  assert.match(verifier, /memberExchanges/);
  assert.match(controller, /TAKU_TELEMETRY state=/);
  assert.match(controller, /sessionRef=/);
  assert.match(
    controller,
    /SafeEvidenceReference\.of\(telemetry\.getProtocol\(\)\.getSessionId\(\)\)/,
  );
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
    player.indexOf('activeUnlockCallback.onShow(evidence.getProviderShowId())') <
      player.indexOf('callback.onRewardVerify(new DJXRewardAdResult(true, rewardPayload))'),
    'the real show identity must be reported before DJX reward verification',
  );
  assert.doesNotMatch(player, /onShow\(launchShowRef\)/);
  assert.doesNotMatch(player, /server-entitlement/);
});
