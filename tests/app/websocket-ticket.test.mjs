import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function importSource(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    return null;
  }
  const source = readFileSync(path, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString(
    'base64',
  )}#${Date.now()}-${Math.random()}`;
  return import(url);
}

const subject = await importSource('pages/chat/util/websocket-ticket.js');
const validTicketOne = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const validTicketTwo = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-vwxyz';

function requireSubject() {
  assert.ok(subject, 'websocket-ticket.js must exist');
  return subject;
}

function okTicket(ticket) {
  return {
    code: 0,
    data: {
      ticket,
      expiresInSeconds: 30,
    },
  };
}

test('initial connection and reconnect each issue a fresh one-time ticket', async () => {
  const { openWebSocketWithFreshTicket } = requireSubject();
  const tickets = [validTicketOne, validTicketTwo];
  const issued = [];
  const connectedUrls = [];

  const issueTicket = async () => {
    const ticket = tickets[issued.length];
    issued.push(ticket);
    return okTicket(ticket);
  };
  const connectSocket = (options) => {
    connectedUrls.push(options.url);
    return { options };
  };

  await openWebSocketWithFreshTicket({
    baseUrl: 'https://api.example.test',
    websocketPath: '/infra/ws',
    issueTicket,
    connectSocket,
  });
  await openWebSocketWithFreshTicket({
    baseUrl: 'https://api.example.test',
    websocketPath: '/infra/ws',
    issueTicket,
    connectSocket,
  });

  assert.deepEqual(issued, tickets);
  assert.equal(connectedUrls.length, 2);
  assert.equal(new URL(connectedUrls[0]).searchParams.get('ticket'), tickets[0]);
  assert.equal(new URL(connectedUrls[1]).searchParams.get('ticket'), tickets[1]);
  assert.notEqual(connectedUrls[0], connectedUrls[1]);
});

test('ticket rejection never reaches connectSocket', async () => {
  const { openWebSocketWithFreshTicket } = requireSubject();
  let connectCalls = 0;

  await assert.rejects(
    openWebSocketWithFreshTicket({
      baseUrl: 'https://api.example.test',
      websocketPath: '/infra/ws',
      issueTicket: async () => ({ code: 401, msg: 'unauthorized', data: null }),
      connectSocket: () => {
        connectCalls += 1;
      },
    }),
    /ticket/i,
  );

  assert.equal(connectCalls, 0);
});

test('ticket request failure never reaches connectSocket', async () => {
  const { openWebSocketWithFreshTicket } = requireSubject();
  let connectCalls = 0;

  await assert.rejects(
    openWebSocketWithFreshTicket({
      baseUrl: 'https://api.example.test',
      websocketPath: '/infra/ws',
      issueTicket: async () => {
        throw new Error('network unavailable');
      },
      connectSocket: () => {
        connectCalls += 1;
      },
    }),
    /network unavailable/,
  );

  assert.equal(connectCalls, 0);
});

test('out-of-contract ticket shape or expiry never reaches connectSocket', async () => {
  const { openWebSocketWithFreshTicket } = requireSubject();
  let connectCalls = 0;
  const rejectedResponses = [
    {
      name: '31 second expiry',
      response: {
        code: 0,
        data: { ticket: validTicketOne, expiresInSeconds: 31 },
      },
    },
    {
      name: '42 character ticket',
      response: { code: 0, data: { ticket: 'A'.repeat(42), expiresInSeconds: 30 } },
    },
    {
      name: '44 character ticket',
      response: { code: 0, data: { ticket: 'A'.repeat(44), expiresInSeconds: 30 } },
    },
    {
      name: 'non-base64url ticket',
      response: { code: 0, data: { ticket: `${'A'.repeat(42)}.`, expiresInSeconds: 30 } },
    },
  ];

  for (const { name, response } of rejectedResponses) {
    await assert.rejects(
      openWebSocketWithFreshTicket({
        baseUrl: 'https://api.example.test',
        websocketPath: '/infra/ws',
        issueTicket: async () => response,
        connectSocket: () => {
          connectCalls += 1;
        },
      }),
      /ticket/i,
      name,
    );
  }

  assert.equal(connectCalls, 0);
});

test('WebSocket URL contains only the short-lived ticket query parameter', async () => {
  const { buildTicketWebSocketUrl, openWebSocketWithFreshTicket } = requireSubject();
  const longLivedAccessToken = 'access_long_lived_secret_0123456789';
  const longLivedRefreshToken = 'refresh_long_lived_secret_9876543210';
  const oneTimeTicket = validTicketOne;
  let connectedUrl;

  const url = buildTicketWebSocketUrl(
    `https://api.example.test?access_token=${longLivedAccessToken}`,
    `/infra/ws?token=${longLivedRefreshToken}&tenant-id=1`,
    oneTimeTicket,
  );
  await openWebSocketWithFreshTicket({
    baseUrl: `https://api.example.test?access_token=${longLivedAccessToken}`,
    websocketPath: `/infra/ws?token=${longLivedRefreshToken}&tenant-id=1`,
    issueTicket: async () => okTicket(oneTimeTicket),
    connectSocket: (options) => {
      connectedUrl = options.url;
      return { options };
    },
  });

  for (const candidate of [url, connectedUrl]) {
    const parsed = new URL(candidate);
    assert.equal(parsed.protocol, 'wss:');
    assert.deepEqual([...parsed.searchParams.keys()], ['ticket']);
    assert.equal(parsed.searchParams.get('ticket'), oneTimeTicket);
    assert.doesNotMatch(candidate, /access_token|refresh_token|tenant-id|[?&]token=/i);
    assert.ok(!candidate.includes(longLivedAccessToken));
    assert.ok(!candidate.includes(longLivedRefreshToken));
  }
});

test('chat socket source contains no access or refresh token URL fallback', () => {
  const source = readFileSync(resolve(root, 'pages/chat/util/useWebSocket.js'), 'utf8');
  const apiSource = readFileSync(
    resolve(root, 'sheep/api/member/websocket-ticket.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /getRefreshToken|getAccessToken/);
  assert.doesNotMatch(source, /[?&]token=/);
  assert.match(source, /WebSocketTicketApi\.issueTicket/);
  assert.match(apiSource, /from ['"]@\/sheep\/request['"]/);
  assert.match(apiSource, /url:\s*['"]\/infra\/websocket-tickets['"]/);
  assert.match(apiSource, /method:\s*['"]POST['"]/);
  assert.match(apiSource, /auth:\s*true/);
  assert.doesNotMatch(apiSource, /getRefreshToken|getAccessToken/);
});

test('checked-in chat bundles contain no long-lived WebSocket token fallback', () => {
  const assetsDirectory = resolve(root, 'android-djx-runtime/static-www/assets');
  const chatBundles = readdirSync(assetsDirectory)
    .filter((name) => /^pages-chat-index.*\.js$/.test(name))
    .sort();
  assert.ok(chatBundles.length > 0, 'at least one checked-in pages-chat-index bundle must exist');

  for (const bundle of chatBundles) {
    const source = readFileSync(resolve(assetsDirectory, bundle), 'utf8');
    assert.doesNotMatch(source, /getRefreshToken|getAccessToken/);
    assert.doesNotMatch(source, /refresh[-_]?token/i);
    assert.doesNotMatch(source, /[?&]token=/i);
    assert.doesNotMatch(
      source,
      /\.replace\(\s*['"]http['"]\s*,\s*['"]ws['"]\s*\)\s*\+\s*['"][?&]token=/i,
    );
  }
});
