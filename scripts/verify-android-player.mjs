import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageName = process.env.SKIT_ANDROID_PACKAGE || 'top.neoshen.xingheyingguan';
const adb =
  process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const forwardPort = Number(process.env.SKIT_CDP_PORT || 9223);
const playerActivity = `${packageName}/.DramaPlayerActivity`;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runAdb(args) {
  const { stdout } = await execFileAsync(adb, args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
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

function summarizePlayerGrant(body, status) {
  try {
    const envelope = JSON.parse(body);
    const grant = envelope?.data || envelope;
    return {
      httpStatus: status,
      code: envelope?.code ?? null,
      message: envelope?.msg || envelope?.message || '',
      grantId: Number(grant?.grantId) || null,
      dramaId: Number(grant?.dramaId) || null,
      expiresAt: grant?.expiresAt || null,
      grantTokenLength:
        typeof grant?.grantToken === 'string' ? grant.grantToken.length : null,
    };
  } catch {
    return { httpStatus: status, parseError: true };
  }
}

function summarizeMemberResponse(url, body, status) {
  let endpoint = url;
  try {
    endpoint = new URL(url).pathname;
  } catch {
    // Keep the original value when URL parsing is unavailable.
  }
  try {
    const envelope = JSON.parse(body);
    return {
      endpoint,
      httpStatus: status,
      code: envelope?.code ?? null,
      message: envelope?.msg || envelope?.message || '',
    };
  } catch {
    return { endpoint, httpStatus: status, parseError: true };
  }
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

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('Node.js 22 or newer is required for the built-in WebSocket client');
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
  const responseReads = [];
  const memberRequests = [];
  const memberResponses = [];
  let playerGrantSummary = null;
  const exportCatalogIndex = process.argv.indexOf('--export-catalog');
  const exportCatalogPath =
    exportCatalogIndex >= 0 ? process.argv[exportCatalogIndex + 1] : null;
  if (exportCatalogIndex >= 0 && !exportCatalogPath) {
    throw new Error('--export-catalog requires an output path');
  }

  try {
    const target = await getTarget(forwardPort);
    if (!target) throw new Error('No debuggable Android WebView target was found');
    if (!target.url.includes('/pages/drama/play')) {
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
        const headers = Object.fromEntries(
          Object.entries(event.params.request.headers || {}).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        );
        memberRequests.push({
          endpoint: new URL(event.params.request.url).pathname,
          method: event.params.request.method,
          hasAuthorization: Boolean(headers.authorization),
          hasTenantId: Boolean(headers['tenant-id']),
          hasNativeVersion: Boolean(headers['x-skit-native-version']),
          hasProtocolVersion: Boolean(headers['x-skit-ad-protocol-version']),
        });
      }
      if (
        event.method === 'Network.responseReceived' &&
        /\/skit\/member\/(?:player-grants|entitlements|ad-sessions)(?:[/?]|$)/.test(
          event.params.response.url,
        )
      ) {
        const read = client
          .send('Network.getResponseBody', { requestId: event.params.requestId })
          .then(({ body, base64Encoded }) => {
            const decoded = base64Encoded
              ? Buffer.from(body, 'base64').toString('utf8')
              : body;
            memberResponses.push(
              summarizeMemberResponse(
                event.params.response.url,
                decoded,
                event.params.response.status,
              ),
            );
            if (/\/player-grants(?:\?|$)/.test(event.params.response.url)) {
              playerGrantSummary = summarizePlayerGrant(decoded, event.params.response.status);
            }
          })
          .catch((error) => consoleMessages.push(`grant response unavailable: ${error.message}`));
        responseReads.push(read);
      }
    });
    await client.connect();
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
    ]);

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

    let topActivity = await waitFor(getTopActivity, (value) => value === playerActivity, 7000);
    if (topActivity !== playerActivity) {
      const clickResult = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const candidates = [...document.querySelectorAll('button, uni-button, [role="button"]')];
          const button = candidates.find((element) => element.textContent.trim() === '开始播放' && visible(element));
          if (!button) return { clicked: false, visibleText: document.body.innerText.slice(0, 800) };
          button.click();
          return { clicked: true, label: button.textContent.trim() };
        })()`,
        returnByValue: true,
      });
      console.log(`manualClick=${JSON.stringify(clickResult.result.value)}`);
      topActivity = await waitFor(getTopActivity, (value) => value === playerActivity, 12000);
    }

    await Promise.allSettled(responseReads);
    const nativeLogs = await runAdb([
      'logcat',
      '-d',
      '-v',
      'brief',
      'SkitPangleDrama:V',
      'SkitDramaPlayer:V',
      'SkitTakuAd:V',
      '*:S',
    ]);

    console.log(`playerGrant=${JSON.stringify(playerGrantSummary)}`);
    console.log(`memberRequests=${JSON.stringify(memberRequests)}`);
    console.log(`memberResponses=${JSON.stringify(memberResponses)}`);
    console.log(`topActivity=${topActivity || '<unknown>'}`);
    if (consoleMessages.length) {
      console.log(`webConsole=${JSON.stringify(consoleMessages.slice(-12))}`);
    }
    if (nativeLogs) console.log(`nativeLogs=\n${redact(nativeLogs)}`);

    if (topActivity !== playerActivity) {
      throw new Error('DramaPlayerActivity did not start');
    }
    console.log('PASS: real drama page opened DramaPlayerActivity');
  } finally {
    client?.close();
    await runAdb(['forward', '--remove', `tcp:${forwardPort}`]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL: ${redact(error.message)}`);
  process.exitCode = 1;
});
