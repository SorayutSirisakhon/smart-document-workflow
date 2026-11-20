// Server-only Node.js adapter. Never import this module into the Vite application.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const API_ORIGIN = 'https://api.line.me';
const RECIPIENT_PATTERN = /^[UCR][0-9a-fA-F]{32}$/;
const RETRY_KEY_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class LineConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LineConfigurationError';
    this.code = 'LINE_CONFIGURATION_ERROR';
  }
}

export class LineApiError extends Error {
  constructor(message, { code = 'LINE_API_ERROR', status, requestId, retryKey, retryable = false } = {}) {
    super(message);
    this.name = 'LineApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryKey = retryKey;
    this.retryable = retryable;
  }
}

export function isValidRecipientId(value) {
  return typeof value === 'string' && RECIPIENT_PATTERN.test(value);
}

function safeHeader(headers, name) {
  const value = headers?.get?.(name);
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function apiErrorMessage(status) {
  if (status === 400) return 'LINE rejected the request. Check the recipient ID and message format.';
  if (status === 401) return 'LINE authentication failed. Check or reissue LINE_CHANNEL_ACCESS_TOKEN.';
  if (status === 403) return 'LINE denied this request. Check the channel permissions and recipient eligibility.';
  if (status === 409) return 'LINE returned a conflict without an accepted request ID. Do not use a new retry key until the original request is checked.';
  if (status === 429) return 'LINE rate limit or message quota was reached. Check the account quota before scheduling another attempt.';
  if (status >= 500) return 'LINE is temporarily unavailable. Retry the identical push request with the same retry key within 24 hours.';
  return `LINE returned HTTP ${status}. Check the Messaging API documentation and request ID.`;
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return null; }
}

/**
 * Create a client only in a trusted Node.js process. This function never logs,
 * persists, or sends credentials anywhere except the fixed official API origin.
 * No request is made until getBotInfo() or pushText() is called explicitly.
 */
export function createLineClient({
  accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxRetries = 2,
  retryDelayMs = 500,
  sleepImpl = sleep,
  randomUUIDImpl = randomUUID,
} = {}) {
  if (typeof window !== 'undefined') throw new LineConfigurationError('LINE credentials must be used by a server-side Node.js process only.');
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new LineConfigurationError('Set LINE_CHANNEL_ACCESS_TOKEN in the server environment.');
  const token = accessToken.trim();
  if (/\s/.test(token)) throw new LineConfigurationError('LINE_CHANNEL_ACCESS_TOKEN must not contain whitespace.');
  if (typeof fetchImpl !== 'function') throw new LineConfigurationError('A Node.js runtime with fetch is required (Node.js 22 or newer recommended).');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new LineConfigurationError('timeoutMs must be an integer from 1 to 120000.');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new LineConfigurationError('maxRetries must be an integer from 0 to 3.');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) throw new LineConfigurationError('retryDelayMs must be an integer from 0 to 30000.');
  if (typeof sleepImpl !== 'function' || typeof randomUUIDImpl !== 'function') throw new LineConfigurationError('Retry helpers must be functions.');

  async function requestOnce(path, { method = 'GET', body, retryKey } = {}) {
    const controller = new AbortController();
    let timeoutId;
    let timedOut = false;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new LineApiError('LINE request timed out. For push messages, retry the identical request with the same retry key.', { code: 'LINE_TIMEOUT', retryKey, retryable: true }));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${API_ORIGIN}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(retryKey ? { 'X-Line-Retry-Key': retryKey } : {}),
            },
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
            redirect: 'error',
          });
          const responseBody = parseJson(await response.text());
          const requestId = safeHeader(response.headers, 'x-line-request-id');
          const acceptedRequestId = safeHeader(response.headers, 'x-line-accepted-request-id');
          if (response.status === 409 && retryKey && acceptedRequestId) {
            return { status: 409, body: responseBody, requestId, acceptedRequestId, duplicate: true };
          }
          if (!response.ok) throw new LineApiError(apiErrorMessage(response.status), {
            status: response.status,
            requestId,
            retryKey,
            retryable: response.status >= 500 && response.status <= 599,
          });
          if (responseBody === null) throw new LineApiError('LINE returned an invalid JSON response. Check the request ID before retrying a push.', { code: 'LINE_INVALID_RESPONSE', requestId, retryKey });
          return { status: response.status, body: responseBody, requestId, duplicate: false };
        })(),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof LineApiError) throw error;
      // Never include raw fetch error messages: they may contain headers or URLs.
      throw new LineApiError(timedOut ? 'LINE request timed out. Retry a push with the same retry key.' : 'Could not reach LINE. Check the network and retry a push with the same retry key.', {
        code: timedOut ? 'LINE_TIMEOUT' : 'LINE_NETWORK_ERROR', retryKey, retryable: true,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function request(path, options) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await requestOnce(path, options); } catch (error) {
        if (!(error instanceof LineApiError) || !error.retryable || attempt >= maxRetries) throw error;
        await sleepImpl(Math.min(30_000, retryDelayMs * (2 ** attempt)));
      }
    }
  }

  return {
    async getBotInfo() {
      const response = await request('/v2/bot/info');
      if (!response.body || typeof response.body.userId !== 'string' || typeof response.body.displayName !== 'string') {
        throw new LineApiError('LINE returned incomplete bot information.', { code: 'LINE_INVALID_RESPONSE', requestId: response.requestId });
      }
      const { userId, basicId, premiumId, displayName, pictureUrl, chatMode, markAsReadMode } = response.body;
      return { userId, basicId, premiumId, displayName, pictureUrl, chatMode, markAsReadMode, requestId: response.requestId };
    },

    async pushText({ to, text, retryKey = randomUUIDImpl() } = {}) {
      if (!isValidRecipientId(to)) throw new LineConfigurationError('Recipient must be a LINE user/group/room ID: U, C, or R followed by 32 hexadecimal characters.');
      if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new LineConfigurationError('Message text must contain 1 to 5000 UTF-16 code units and must not be blank.');
      if (typeof retryKey !== 'string' || !RETRY_KEY_PATTERN.test(retryKey)) throw new LineConfigurationError('retryKey must be a hexadecimal UUID. Persist and reuse it only for the identical request.');
      // Build once so every automatic retry has the same recipient and content.
      const body = JSON.stringify({ to, messages: [{ type: 'text', text }] });
      const response = await request('/v2/bot/message/push', { method: 'POST', body, retryKey });
      return {
        accepted: true,
        duplicate: response.duplicate,
        retryKey,
        requestId: response.requestId,
        acceptedRequestId: response.acceptedRequestId,
        messageIds: Array.isArray(response.body?.sentMessages)
          ? response.body.sentMessages.filter((item) => typeof item?.id === 'string').map((item) => item.id)
          : [],
      };
    },
  };
}

/** Verify exact raw bytes BEFORE JSON parsing. A false result must stop processing. */
export function verifyWebhookSignature({ rawBody, signature, channelSecret = process.env.LINE_CHANNEL_SECRET } = {}) {
  if (typeof channelSecret !== 'string' || !channelSecret) throw new LineConfigurationError('Set LINE_CHANNEL_SECRET in the server environment before receiving webhooks.');
  if (!(typeof rawBody === 'string' || rawBody instanceof Uint8Array)) throw new TypeError('rawBody must be the unmodified request body string or bytes, not parsed JSON.');
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  const received = Buffer.from(signature, 'base64');
  return received.length === expected.length && received.toString('base64') === signature && timingSafeEqual(expected, received);
}
