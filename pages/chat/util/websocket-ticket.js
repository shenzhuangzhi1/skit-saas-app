const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_TICKET_TTL_SECONDS = 30;

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function extractTicket(response) {
  if (!response || response.code !== 0 || !response.data) {
    throw new Error('WebSocket ticket issuance failed');
  }

  const ticket = response.data.ticket;
  const expiresInSeconds = Number(response.data.expiresInSeconds);
  if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
    throw new Error('WebSocket ticket is invalid');
  }
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    expiresInSeconds > MAX_TICKET_TTL_SECONDS
  ) {
    throw new Error('WebSocket ticket expiry is invalid');
  }
  return ticket;
}

export function buildTicketWebSocketUrl(baseUrl, websocketPath, ticket) {
  const normalizedBaseUrl = requireNonEmptyString(baseUrl, 'WebSocket base URL');
  const normalizedPath = requireNonEmptyString(websocketPath, 'WebSocket path');
  if (/[@\\\u0000-\u001f\u007f]/.test(normalizedBaseUrl)) {
    throw new Error('WebSocket base URL is invalid');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath) || /[\\\u0000-\u001f\u007f]/.test(normalizedPath)) {
    throw new Error('WebSocket path is invalid');
  }

  const baseMatch = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(normalizedBaseUrl);
  if (!baseMatch) {
    throw new Error('WebSocket base URL must use HTTP or HTTPS');
  }
  const protocol = baseMatch[1].toLowerCase() === 'https' ? 'wss' : 'ws';
  const host = baseMatch[2];
  const path = normalizedPath.split(/[?#]/, 1)[0];
  const absolutePath = path.startsWith('/') ? path : `/${path}`;
  const safeTicket = extractTicket({
    code: 0,
    data: { ticket, expiresInSeconds: 1 },
  });

  return `${protocol}://${host}${absolutePath}?ticket=${encodeURIComponent(safeTicket)}`;
}

export async function openWebSocketWithFreshTicket({
  baseUrl,
  websocketPath,
  issueTicket,
  connectSocket,
  isCancelled = () => false,
}) {
  if (typeof issueTicket !== 'function' || typeof connectSocket !== 'function') {
    throw new Error('WebSocket ticket connector is not configured');
  }

  const response = await issueTicket();
  const ticket = extractTicket(response);
  if (isCancelled()) {
    throw new Error('WebSocket connection was cancelled');
  }

  return connectSocket({
    url: buildTicketWebSocketUrl(baseUrl, websocketPath, ticket),
  });
}
