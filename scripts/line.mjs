#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLineClient, LineApiError, LineConfigurationError } from '../integrations/line.mjs';

const HELP = `LINE server-side utility (Node.js 22+)\n\nCommands:\n  node scripts/line.mjs check\n    Read bot account information. Does not send a message.\n\n  node scripts/line.mjs push --to <U/C/R + 32 hex> --text <message> [--retry-key <UUID>]\n    Send one real text message explicitly. May consume the account message quota.\n\nCredentials are read from LINE_CHANNEL_ACCESS_TOKEN in the process environment.\nNever put credentials in VITE_* variables, source code, or command arguments.\nSee docs/line.md for setup, recipient IDs, retries, and webhook verification.\n`;

function parseArguments(argv) {
  const [command = 'help', ...args] = argv;
  if (['help', '--help', '-h'].includes(command)) {
    if (args.length) throw new LineConfigurationError('Help does not accept arguments.');
    return { command: 'help' };
  }
  if (command === 'check') {
    if (args.length) throw new LineConfigurationError('check does not accept arguments.');
    return { command };
  }
  if (command !== 'push') throw new LineConfigurationError('Unknown command. Use help, check, or push.');
  const values = {};
  const allowed = new Set(['--to', '--text', '--retry-key']);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) throw new LineConfigurationError('Unknown or repeated push option. Use --to, --text, and optionally --retry-key.');
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new LineConfigurationError(`Missing value for ${flag}.`);
    values[flag] = args[index + 1];
  }
  if (!values['--to'] || !values['--text']) throw new LineConfigurationError('push requires both --to and --text.');
  return { command, to: values['--to'], text: values['--text'], retryKey: values['--retry-key'] };
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  clientFactory = createLineClient,
} = {}) {
  try {
    const options = parseArguments(argv);
    if (options.command === 'help') { stdout(HELP); return 0; }
    const client = clientFactory({ accessToken: env.LINE_CHANNEL_ACCESS_TOKEN });
    if (options.command === 'check') {
      stdout(`${JSON.stringify({ ok: true, bot: await client.getBotInfo() }, null, 2)}\n`);
    } else {
      const result = await client.pushText({ to: options.to, text: options.text, ...(options.retryKey ? { retryKey: options.retryKey } : {}) });
      stdout(`${JSON.stringify({ ok: true, ...result, note: 'Accepted by LINE; this does not confirm delivery or that the recipient read the message.' }, null, 2)}\n`);
    }
    return 0;
  } catch (error) {
    const known = error instanceof LineApiError || error instanceof LineConfigurationError;
    stderr(`${JSON.stringify({ ok: false, error: {
      code: known ? error.code : 'LINE_UNEXPECTED_ERROR',
      message: known ? error.message : 'An unexpected LINE utility error occurred. No raw error or credentials were logged.',
      ...(error instanceof LineApiError ? { status: error.status, requestId: error.requestId, retryKey: error.retryKey, retryable: error.retryable } : {}),
    } }, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
