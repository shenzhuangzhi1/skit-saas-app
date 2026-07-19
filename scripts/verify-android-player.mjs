import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  assertFreshRewardChainEvidence,
  summarizeMemberRequest,
  summarizeMemberResponse,
  toSafeEvidenceLog,
} from './lib/reward-chain-evidence.mjs';

const execFileAsync = promisify(execFile);
const packageName = process.env.SKIT_ANDROID_PACKAGE || 'top.neoshen.xingheyingguan';
const adb =
  process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const forwardPort = Number(process.env.SKIT_CDP_PORT || 9223);
const playerActivity = `${packageName}/.DramaPlayerActivity`;
const verifyRewardChain = process.argv.includes('--verify-reward-chain');
const dramaIndex = process.argv.indexOf('--drama');
const requestedDrama = dramaIndex >= 0 ? Number(process.argv[dramaIndex + 1]) : null;
const episodeIndex = process.argv.indexOf('--episode');
const requestedEpisode = episodeIndex >= 0 ? Number(process.argv[episodeIndex + 1]) : null;

if (
  dramaIndex >= 0 &&
  (!Number.isSafeInteger(requestedDrama) || requestedDrama <= 0)
) {
  throw new Error('--drama requires a positive integer');
}

if (
  episodeIndex >= 0 &&
  (!Number.isSafeInteger(requestedEpisode) || requestedEpisode <= 0)
) {
  throw new Error('--episode requires a positive integer');
}

if (verifyRewardChain && (requestedDrama === null || requestedEpisode === null)) {
  throw new Error('--verify-reward-chain requires explicit --drama and --episode values');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runAdb(args) {
  const { stdout } = await execFileAsync(adb, args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function readNativeLogs() {
  return runAdb([
    'logcat',
    '-d',
    '-v',
    'brief',
    'SkitPangleDrama:V',
    'SkitDramaPlayer:V',
    'SkitTakuAd:V',
    '*:S',
  ]);
}

async function waitFor(getValue, predicate, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await getValue();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(intervalMs);
  }
  return lastValue;
}

class CdpClient {
  constructor(url, onEvent) {
    this.url = url;
    this.onEvent = onEvent;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', async (event) => {
      const raw =
        typeof event.data === 'string'
          ? event.data
          : Buffer.from(await event.data.arrayBuffer()).toString('utf8');
      const message = JSON.parse(raw);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      this.onEvent?.(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function redact(value) {
  return String(value || '')
    .replace(/[A-Za-z0-9_-]{22,}/g, '<redacted>')
    .replace(/(app[_ -]?key\s*[=:]\s*)\S+/gi, '$1<redacted>');
}

async function getTopActivity() {
  const activities = await runAdb(['shell', 'dumpsys', 'activity', 'activities']);
  const match = activities.match(/topResumedActivity=ActivityRecord\{[^\n]*\s([^\s}]+)\s+t\d+\}/);
  return match?.[1] || '';
}

async function getTarget(port) {
  return waitFor(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`);
        const targets = await response.json();
        return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      } catch {
        return null;
      }
    },
    Boolean,
    5000,
  );
}

async function findVisibleButton(client, label) {
  return client.send('Runtime.evaluate', {
    expression: `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const candidates = [...document.querySelectorAll('button, uni-button, [role="button"]')];
      const button = candidates.find((element) => element.textContent.trim() === ${JSON.stringify(
        label,
      )} && visible(element));
      if (!button) {
        return {
          clicked: false,
          visibleLabels: candidates
            .filter(visible)
            .map((element) => element.textContent.trim())
            .filter(Boolean)
            .slice(0, 20),
        };
      }
      const rect = button.getBoundingClientRect();
      return {
        found: true,
        label: button.textContent.trim(),
        screenX: Math.round((rect.left + rect.width / 2) * window.devicePixelRatio),
        screenY: Math.round((rect.top + rect.height / 2) * window.devicePixelRatio),
      };
    })()`,
    returnByValue: true,
  });
}

async function clickVisibleButton(client, label, useNativeTap, onBeforeClick) {
  const located = await waitFor(
    () => findVisibleButton(client, label),
    (value) => value?.result?.value?.found === true,
    12000,
    500,
  );
  const target = located?.result?.value;
  if (!target?.found) {
    return { clicked: false, visibleLabels: target?.visibleLabels || [] };
  }
  await onBeforeClick?.();
  if (useNativeTap) {
    await runAdb(['shell', 'input', 'tap', String(target.screenX), String(target.screenY)]);
  } else {
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const candidates = [...document.querySelectorAll('button, uni-button, [role="button"]')];
        const button = candidates.find((element) => element.textContent.trim() === ${JSON.stringify(
          label,
        )} && visible(element));
        if (!button) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
    });
  }
  return { clicked: true, label: target.label, input: useNativeTap ? 'adb-tap' : 'dom-click' };
}

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('Node.js 22 or newer is required for the built-in WebSocket client');
  }

  const initialTopActivity = await getTopActivity();
  if (verifyRewardChain && initialTopActivity === playerActivity) {
    throw new Error('Close the existing DramaPlayerActivity before reward verification');
  }

  const pid = await waitFor(
    () => runAdb(['shell', 'pidof', packageName]).catch(() => ''),
    Boolean,
    5000,
  );
  if (!pid) throw new Error(`Android process is not running: ${packageName}`);

  await runAdb([
    'forward',
    `tcp:${forwardPort}`,
    `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`,
  ]);

  let client;
  const consoleMessages = [];
  const memberRequestById = new Map();
  const memberExchanges = [];
  let responseReadFailures = 0;
  let evidenceRunId = 0;
  let entitlementsReady = false;
  let rewardClickPerformed = false;
  let rewardEvidenceDeadline = 0;
  const exportCatalogIndex = process.argv.indexOf('--export-catalog');
  const exportCatalogPath =
    exportCatalogIndex >= 0 ? process.argv[exportCatalogIndex + 1] : null;
  if (exportCatalogIndex >= 0 && !exportCatalogPath) {
    throw new Error('--export-catalog requires an output path');
  }

  try {
    const target = await getTarget(forwardPort);
    if (!target) throw new Error('No debuggable Android WebView target was found');
    if (!target.url.includes('/pages/drama/play') && requestedDrama === null) {
      throw new Error(`Open a real drama page before verification; current URL is ${target.url}`);
    }

    client = new CdpClient(target.webSocketDebuggerUrl, (event) => {
      if (event.method === 'Runtime.consoleAPICalled') {
        const line = event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (/drama|player|authoriz|entitlement/i.test(line)) {
          consoleMessages.push(redact(line));
        }
      }
      if (event.method === 'Runtime.exceptionThrown') {
        consoleMessages.push(redact(event.params.exceptionDetails?.text || 'Runtime exception'));
      }
      if (
        event.method === 'Network.requestWillBeSent' &&
        /\/skit\/member\/(?:player-grants|entitlements|ad-sessions)(?:[/?]|$)/.test(
          event.params.request.url,
        )
      ) {
        memberRequestById.set(event.params.requestId, {
          runId: evidenceRunId,
          request: summarizeMemberRequest(
            event.params.request.url,
            event.params.request,
          ),
        });
      }
      if (
        event.method === 'Network.responseReceived' &&
        /\/skit\/member\/(?:player-grants|entitlements|ad-sessions)(?:[/?]|$)/.test(
          event.params.response.url,
        )
      ) {
        const requestRecord = memberRequestById.get(event.params.requestId);
        void client
          .send('Network.getResponseBody', { requestId: event.params.requestId })
          .then(({ body, base64Encoded }) => {
            const decoded = base64Encoded
              ? Buffer.from(body, 'base64').toString('utf8')
              : body;
            const responseSummary = summarizeMemberResponse(
              event.params.response.url,
              decoded,
              event.params.response.status,
            );
            if (
              requestRecord?.request.endpoint.endsWith('/entitlements') &&
              requestRecord.request.dramaId === requestedDrama &&
              responseSummary.endpoint.endsWith('/entitlements') &&
              responseSummary.httpStatus === 200 &&
              responseSummary.code === 0 &&
              responseSummary.dramaId === requestedDrama
            ) {
              entitlementsReady = true;
            }
            if (requestRecord?.runId > 0) {
              memberExchanges.push({
                runId: requestRecord.runId,
                request: requestRecord.request,
                response: responseSummary,
              });
            }
          })
          .catch(() => {
            responseReadFailures += 1;
          });
      }
    });
    await client.connect();
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
    ]);

    if (requestedDrama !== null || requestedEpisode !== null) {
      const currentUrl = new URL(target.url);
      if (!currentUrl.hash.includes('/pages/drama/play')) {
        currentUrl.hash = '#/pages/drama/play';
      }
      if (requestedDrama !== null) {
        currentUrl.hash = currentUrl.hash.match(/([?&])id=\d+/)
          ? currentUrl.hash.replace(/([?&])id=\d+/, `$1id=${requestedDrama}`)
          : `${currentUrl.hash}${currentUrl.hash.includes('?') ? '&' : '?'}id=${requestedDrama}`;
      }
      if (requestedEpisode !== null) {
        currentUrl.hash = currentUrl.hash.match(/([?&])episode=\d+/)
          ? currentUrl.hash.replace(/([?&])episode=\d+/, `$1episode=${requestedEpisode}`)
          : `${currentUrl.hash}${currentUrl.hash.includes('?') ? '&' : '?'}episode=${requestedEpisode}`;
      }
      await client.send('Runtime.evaluate', {
        expression: `location.hash = ${JSON.stringify(currentUrl.hash)}`,
      });
      await sleep(500);
    }

    if (exportCatalogPath) {
      const exported = await client.send('Runtime.evaluate', {
        expression: `(() => {
          let cached = JSON.parse(localStorage.getItem('skit_external_drama_cache_v1') || '[]');
          for (let depth = 0; depth < 3 && !Array.isArray(cached); depth += 1) {
            if (typeof cached === 'string') {
              cached = JSON.parse(cached);
            } else if (cached && typeof cached === 'object' && 'data' in cached) {
              cached = cached.data;
            } else if (cached && typeof cached === 'object' && 'value' in cached) {
              cached = cached.value;
            } else {
              break;
            }
          }
          if (!Array.isArray(cached)) return [];
          return cached
            .map((item) => item && typeof item === 'object' ? (item.raw || item) : null)
            .filter((item) => item && typeof item === 'object');
        })()`,
        returnByValue: true,
      });
      const catalog = exported.result?.value;
      if (!Array.isArray(catalog) || catalog.length === 0) {
        const storageKeys = await client.send('Runtime.evaluate', {
          expression: `Object.keys(localStorage)
            .filter((key) => /drama/i.test(key))
            .map((key) => ({ key, length: String(localStorage.getItem(key) || '').length }))`,
          returnByValue: true,
        });
        throw new Error(
          `The Android SDK drama cache is empty; candidates=${JSON.stringify(
            storageKeys.result?.value || [],
          )}`,
        );
      }
      await writeFile(exportCatalogPath, `${JSON.stringify({ list: catalog }, null, 2)}\n`, {
        mode: 0o600,
      });
      console.log(`PASS: exported ${catalog.length} SDK dramas to ${exportCatalogPath}`);
      return;
    }

    await runAdb(['logcat', '-c']);
    await client.send('Page.reload', { ignoreCache: true });

    let topActivity = await waitFor(
      getTopActivity,
      (value) => value === playerActivity,
      verifyRewardChain ? 1500 : 7000,
    );
    if (topActivity !== playerActivity) {
      const expectedLabel = verifyRewardChain ? '看广告解锁' : '开始播放';
      if (verifyRewardChain) {
        const ready = await waitFor(
          async () => entitlementsReady,
          Boolean,
          12000,
          250,
        );
        if (!ready) {
          throw new Error('Server entitlements were not ready before the reward test');
        }
      }
      const clickResult = await clickVisibleButton(
        client,
        expectedLabel,
        verifyRewardChain,
            verifyRewardChain
              ? () => {
                  evidenceRunId += 1;
                  memberExchanges.length = 0;
                  rewardEvidenceDeadline = Date.now() + 240000;
                }
          : undefined,
      );
      console.log(
        `manualClick=${JSON.stringify({
          clicked: clickResult.clicked,
          input: clickResult.input || null,
        })}`,
      );
      if (!clickResult.clicked) {
        throw new Error(`Visible button was not found: ${expectedLabel}`);
      }
      if (verifyRewardChain) {
        rewardClickPerformed = true;
      }

      let previousActivity = '';
      topActivity = await waitFor(
        async () => {
          const activity = await getTopActivity();
          if (activity && activity !== previousActivity) {
            previousActivity = activity;
            console.log(`activity=${activity}`);
          }
          return activity;
            },
            (value) => value === playerActivity,
            verifyRewardChain
              ? Math.max(1, rewardEvidenceDeadline - Date.now())
              : 12000,
            verifyRewardChain ? 1000 : 250,
          );
        }

    let nativeLogs = '';
    let rewardEvidenceResult = null;
    if (verifyRewardChain && topActivity === playerActivity) {
      rewardEvidenceResult = await waitFor(
        async () => {
          const logs = await readNativeLogs();
          try {
            const correlation = assertFreshRewardChainEvidence({
              runId: evidenceRunId,
              rewardClickPerformed,
              requestedDrama,
              requestedEpisode,
              nativeLogs: logs,
              exchanges: memberExchanges,
            });
            return { state: 'PASSED', nativeLogs: logs, correlation };
          } catch (error) {
            const failed = String(error?.message || '').includes(
              'Target player request failed',
            );
            return {
              state: failed ? 'FAILED' : 'PENDING',
              nativeLogs: logs,
              error,
            };
          }
        },
        (value) => value?.state === 'PASSED' || value?.state === 'FAILED',
        Math.max(1, rewardEvidenceDeadline - Date.now()),
        1000,
      );
      nativeLogs = rewardEvidenceResult?.nativeLogs || (await readNativeLogs());
    } else {
      nativeLogs = await readNativeLogs();
    }

    console.log(
      `memberEvidence=${JSON.stringify(
        toSafeEvidenceLog(
          memberExchanges.filter((exchange) => exchange.runId === evidenceRunId),
        ),
      )}`,
    );
    console.log(`topActivity=${topActivity || '<unknown>'}`);
    console.log(`webConsoleCount=${consoleMessages.length}`);
    console.log(`responseReadFailures=${responseReadFailures}`);
    if (nativeLogs) console.log(`nativeLogs=\n${redact(nativeLogs)}`);

    if (topActivity !== playerActivity) {
      throw new Error('DramaPlayerActivity did not start');
    }
    if (verifyRewardChain) {
      if (rewardEvidenceResult?.state === 'FAILED') {
        throw rewardEvidenceResult.error;
      }
      if (rewardEvidenceResult?.state !== 'PASSED') {
        const lastFailure = redact(
          rewardEvidenceResult?.error?.message || 'no correlated playback evidence',
        );
        throw new Error(`Timed out waiting for real DJX video playback: ${lastFailure}`);
      }
      const correlation = rewardEvidenceResult.correlation;
      console.log(
        `rewardEvidence=${JSON.stringify({
          session: 'session#1',
          providerShowRef: correlation.providerShowRef,
        })}`,
      );
    }
    console.log(
      verifyRewardChain
        ? 'PASS: Taku reward verification reached real DJX video playback'
        : 'PASS: real drama page opened DramaPlayerActivity',
    );
  } finally {
    client?.close();
    await runAdb(['forward', '--remove', `tcp:${forwardPort}`]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL: ${redact(error.message)}`);
  process.exitCode = 1;
});
