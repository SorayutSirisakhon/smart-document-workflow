import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createLineClient, isValidRecipientId, LineApiError, LineConfigurationError, verifyWebhookSignature } from './line.mjs';
import { main } from '../scripts/line.mjs';

const TOKEN = 'mock-channel-token-do-not-log';
const TO = `U${'a'.repeat(32)}`;
const RETRY_KEY = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_KEY = '123e4567-e89b-42d3-a456-426614174001';
const ok = (status = 200, body = {}, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: new Headers(headers), text: async () => JSON.stringify(body),
});
const client = (fetchImpl, options = {}) => createLineClient({
  accessToken: TOKEN, fetchImpl, maxRetries: 0, randomUUIDImpl: () => RETRY_KEY, ...options,
});

test('recipient validation accepts user, group, and room hex identifiers', () => {
  for (const prefix of ['U', 'C', 'R']) assert.equal(isValidRecipientId(`${prefix}${'aF012345'.repeat(4)}`), true);
});

test('recipient validation rejects LINE handles, malformed IDs, and non-strings', () => {
  for (const value of ['@company', TO.slice(1), `${TO}a`, `u${'a'.repeat(32)}`, `U${'z'.repeat(32)}`, '', null, 1, `${TO}\n`]) {
    assert.equal(isValidRecipientId(value), false);
  }
});

test('creating a client makes no network request', () => {
  let calls = 0;
  client(async () => { calls += 1; throw new Error('unexpected'); });
  assert.equal(calls, 0);
});

test('a missing token fails before a request', () => {
  assert.throws(() => createLineClient({ accessToken: '' }), LineConfigurationError);
});

test('a token containing whitespace is rejected without echoing it', () => {
  assert.throws(() => createLineClient({ accessToken: `${TOKEN}\r\nheader` }), (error) => {
    assert.equal(error.message.includes(TOKEN), false);
    return error instanceof LineConfigurationError;
  });
});

test('invalid client retry and timeout limits are rejected', () => {
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 120001 }, { maxRetries: -1 }, { maxRetries: 4 }, { retryDelayMs: -1 }, { fetchImpl: null }]) {
    assert.throws(() => createLineClient({ accessToken: TOKEN, ...options }), LineConfigurationError);
  }
});

test('bot check uses the official fixed GET endpoint without a push or retry key', async () => {
  let calls = 0;
  const api = client(async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.line.me/v2/bot/info');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers['X-Line-Retry-Key'], undefined);
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    return ok(200, { userId: TO, displayName: 'Mock bot', basicId: '@mock', unexpectedSecret: TOKEN }, { 'x-line-request-id': 'request-1' });
  });
  const result = await api.getBotInfo();
  assert.equal(result.displayName, 'Mock bot');
  assert.equal(result.requestId, 'request-1');
  assert.equal(result.unexpectedSecret, undefined);
  assert.equal(calls, 1);
});

test('bot check rejects incomplete bot information', async () => {
  await assert.rejects(client(async () => ok(200, { displayName: 'missing userId' })).getBotInfo(), { code: 'LINE_INVALID_RESPONSE' });
});

test('push sends one UTF-8 text payload and a retry key to the official endpoint', async () => {
  const api = client(async (url, options) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['X-Line-Retry-Key'], RETRY_KEY);
    assert.deepEqual(JSON.parse(options.body), { to: TO, messages: [{ type: 'text', text: 'ทดสอบใบเสนอราคา' }] });
    assert.ok(options.signal instanceof AbortSignal);
    return ok(200, { sentMessages: [{ id: 'message-1' }] }, { 'x-line-request-id': 'request-2' });
  });
  assert.deepEqual(await api.pushText({ to: TO, text: 'ทดสอบใบเสนอราคา' }), {
    accepted: true, duplicate: false, retryKey: RETRY_KEY, requestId: 'request-2', acceptedRequestId: undefined, messageIds: ['message-1'],
  });
});

test('blank or over-limit text never reaches fetch', async () => {
  let calls = 0;
  const api = client(async () => { calls += 1; return ok(); });
  for (const text of ['', '   ', null, '🍎'.repeat(2501)]) {
    await assert.rejects(api.pushText({ to: TO, text }), LineConfigurationError);
  }
  assert.equal(calls, 0);
});

test('text limit counts UTF-16 code units and accepts exactly 5000', async () => {
  let calls = 0;
  await client(async () => { calls += 1; return ok(); }).pushText({ to: TO, text: '🍎'.repeat(2500) });
  assert.equal(calls, 1);
});

test('invalid recipient fails before fetch', async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls += 1; return ok(); }).pushText({ to: '@handle', text: 'test' }), LineConfigurationError);
  assert.equal(calls, 0);
});

test('invalid retry key fails before fetch', async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls += 1; return ok(); }).pushText({ to: TO, text: 'test', retryKey: 'bad' }), LineConfigurationError);
  assert.equal(calls, 0);
});

test('5xx retry keeps identical recipient, body, and retry key with exponential delay', async () => {
  const requests = [];
  const delays = [];
  const api = client(async (_, options) => {
    requests.push({ body: options.body, key: options.headers['X-Line-Retry-Key'] });
    return requests.length < 3 ? ok(503) : ok();
  }, { maxRetries: 2, retryDelayMs: 10, sleepImpl: async (delay) => { delays.push(delay); } });
  await api.pushText({ to: TO, text: 'test', retryKey: OTHER_KEY });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests, [requests[0], requests[0], requests[0]]);
  assert.equal(requests[0].key, OTHER_KEY);
  assert.deepEqual(delays, [10, 20]);
});

test('authentication error is not automatically retried', async () => {
  let calls = 0;
  const api = client(async () => { calls += 1; return ok(401); }, { maxRetries: 3, sleepImpl: async () => {} });
  await assert.rejects(api.pushText({ to: TO, text: 'test' }), { status: 401, retryable: false, retryKey: RETRY_KEY });
  assert.equal(calls, 1);
});

test('429 quota/rate limit error is not automatically retried', async () => {
  let calls = 0;
  const api = client(async () => { calls += 1; return ok(429); }, { maxRetries: 3, sleepImpl: async () => {} });
  await assert.rejects(api.pushText({ to: TO, text: 'test' }), { status: 429, retryable: false });
  assert.equal(calls, 1);
});

test('409 with accepted request header is returned as already accepted', async () => {
  const result = await client(async () => ok(409, {}, { 'x-line-accepted-request-id': 'original-request' })).pushText({ to: TO, text: 'test' });
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.acceptedRequestId, 'original-request');
});

test('409 without accepted request header remains an error', async () => {
  await assert.rejects(client(async () => ok(409)).pushText({ to: TO, text: 'test' }), { status: 409, retryable: false });
});

test('network failures have bounded retries and do not leak the raw error or token', async () => {
  let calls = 0;
  const api = client(async () => { calls += 1; throw new Error(`network dump ${TOKEN}`); }, { maxRetries: 2, sleepImpl: async () => {} });
  await assert.rejects(api.pushText({ to: TO, text: 'test' }), (error) => {
    assert.equal(error.code, 'LINE_NETWORK_ERROR');
    assert.equal(error.retryKey, RETRY_KEY);
    assert.equal(JSON.stringify(error).includes(TOKEN), false);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(calls, 3);
});

test('timeout aborts a pending request and preserves the push retry key', async () => {
  let signal;
  const api = client(async (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }, { timeoutMs: 5 });
  await assert.rejects(api.pushText({ to: TO, text: 'test' }), { code: 'LINE_TIMEOUT', retryKey: RETRY_KEY, retryable: true });
  assert.equal(signal.aborted, true);
});

test('invalid success JSON is not automatically resent', async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return { ...ok(), text: async () => '<not-json>' };
  }, { maxRetries: 3 });
  await assert.rejects(api.pushText({ to: TO, text: 'test' }), { code: 'LINE_INVALID_RESPONSE', retryable: false });
  assert.equal(calls, 1);
});

test('exhausted server error includes a safe request ID and retry information', async () => {
  await assert.rejects(client(async () => ok(502, {}, { 'x-line-request-id': 'request-502' })).pushText({ to: TO, text: 'test' }), {
    status: 502, requestId: 'request-502', retryKey: RETRY_KEY, retryable: true,
  });
});

test('API response body and unsafe request headers are not reflected in errors', async () => {
  await assert.rejects(client(async () => ok(400, { message: TOKEN }, { 'x-line-request-id': `unsafe ${TOKEN}` })).pushText({ to: TO, text: 'test' }), (error) => {
    assert.equal(error.message.includes(TOKEN), false);
    assert.equal(error.requestId, undefined);
    return error instanceof LineApiError;
  });
});

const RAW = Buffer.from('{"events":[],"note":"สวัสดี"}');
const SECRET = 'mock-channel-secret';
const SIGNATURE = createHmac('sha256', SECRET).update(RAW).digest('base64');

test('webhook signature verifies the exact raw UTF-8 bytes and string', () => {
  assert.equal(verifyWebhookSignature({ rawBody: RAW, signature: SIGNATURE, channelSecret: SECRET }), true);
  assert.equal(verifyWebhookSignature({ rawBody: RAW.toString('utf8'), signature: SIGNATURE, channelSecret: SECRET }), true);
});

test('webhook signature fails for modified body or wrong secret', () => {
  assert.equal(verifyWebhookSignature({ rawBody: `${RAW.toString()} `, signature: SIGNATURE, channelSecret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: RAW, signature: SIGNATURE, channelSecret: 'wrong' }), false);
});

test('missing, malformed, and truncated signatures fail closed', () => {
  for (const signature of [undefined, '', 'not-base64', SIGNATURE.slice(1), `${SIGNATURE}\n`, 'A'.repeat(44)]) {
    assert.equal(verifyWebhookSignature({ rawBody: RAW, signature, channelSecret: SECRET }), false);
  }
});

test('webhook helper rejects parsed JSON and missing channel secret', () => {
  assert.throws(() => verifyWebhookSignature({ rawBody: {}, signature: SIGNATURE, channelSecret: SECRET }), TypeError);
  assert.throws(() => verifyWebhookSignature({ rawBody: RAW, signature: SIGNATURE, channelSecret: '' }), LineConfigurationError);
});

function cliOutput() {
  const output = { stdout: '', stderr: '' };
  return { output, stdout: (text) => { output.stdout += text; }, stderr: (text) => { output.stderr += text; } };
}

test('CLI help neither requires credentials nor creates a network client', async () => {
  const { output, ...io } = cliOutput();
  assert.equal(await main([], { ...io, env: {}, clientFactory: () => { throw new Error('should not run'); } }), 0);
  assert.match(output.stdout, /Commands:/);
});

test('CLI check reads bot information and never calls push', async () => {
  const { output, ...io } = cliOutput();
  let checked = 0;
  assert.equal(await main(['check'], { ...io, env: { LINE_CHANNEL_ACCESS_TOKEN: TOKEN }, clientFactory: ({ accessToken }) => {
    assert.equal(accessToken, TOKEN);
    return { getBotInfo: async () => { checked += 1; return { displayName: 'Mock bot' }; }, pushText: async () => { throw new Error('unexpected push'); } };
  } }), 0);
  assert.equal(checked, 1);
  assert.equal(output.stdout.includes(TOKEN), false);
});

test('CLI push only sends the explicitly provided recipient and text', async () => {
  const { output, ...io } = cliOutput();
  let calls = 0;
  assert.equal(await main(['push', '--to', TO, '--text', 'manual test', '--retry-key', RETRY_KEY], { ...io, env: {}, clientFactory: () => ({
    pushText: async (input) => { calls += 1; assert.deepEqual(input, { to: TO, text: 'manual test', retryKey: RETRY_KEY }); return { accepted: true, retryKey: RETRY_KEY }; },
  }) }), 0);
  assert.equal(calls, 1);
  assert.match(output.stdout, /does not confirm delivery/);
});

test('CLI errors omit raw unexpected errors and credentials', async () => {
  const { output, ...io } = cliOutput();
  assert.equal(await main(['check'], { ...io, env: {}, clientFactory: () => { throw new Error(TOKEN); } }), 1);
  assert.equal(output.stderr.includes(TOKEN), false);
  assert.match(output.stderr, /LINE_UNEXPECTED_ERROR/);
});

test('CLI invalid commands fail before creating a client or sending', async () => {
  for (const argv of [['send'], ['check', '--text', 'bad'], ['push'], ['push', '--to'], ['push', '--token', TOKEN], ['push', '--to', TO, '--to', TO, '--text', 'bad']]) {
    const { output, ...io } = cliOutput();
    assert.equal(await main(argv, { ...io, env: {}, clientFactory: () => { throw new Error('should not run'); } }), 1);
    assert.match(output.stderr, /LINE_CONFIGURATION_ERROR/);
    assert.equal(output.stderr.includes(TOKEN), false);
  }
});
