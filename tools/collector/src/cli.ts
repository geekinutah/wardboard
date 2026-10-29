import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cleanup, collect } from './collect.ts';
import { ConfigError, loadConfig, type DirectoryConfig } from './config.ts';

/**
 * collect --staging <dir> [--config <file>] [--resume | --cleanup] [--headless]
 *
 * A thin wrapper over `collect()` and `cleanup()`: the same code path whether
 * a person or an optional AI operator runs it. Exit codes: 0 success,
 * 1 collection failed or cancelled, 2 bad arguments or refused staging.
 */

const USAGE = 'Usage: collect --staging <dir> [--config <file>] [--resume | --cleanup] [--headless]';
const DEFAULT_CONFIG = fileURLToPath(new URL('../config/directory.json', import.meta.url));

type Args = { staging: string; config: string; resume: boolean; cleanup: boolean; headless: boolean };

function parseArgs(argv: string[]): Args | string {
  let staging: string | undefined;
  let config = DEFAULT_CONFIG;
  let resumeFlag = false;
  let cleanupFlag = false;
  let headless = false;
  // `pnpm run collect -- …` may pass the separator through; it carries no meaning here.
  const args = argv.filter((arg) => arg !== '--');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = (): string | undefined => {
      const next = args[i + 1];
      i += 1;
      return next === undefined || next.startsWith('--') ? undefined : next;
    };
    switch (arg) {
      case '--staging': {
        const next = value();
        if (next === undefined) return '--staging needs a folder.';
        staging = next;
        break;
      }
      case '--config': {
        const next = value();
        if (next === undefined) return '--config needs a file.';
        config = next;
        break;
      }
      case '--resume':
        resumeFlag = true;
        break;
      case '--cleanup':
        cleanupFlag = true;
        break;
      case '--headless':
        headless = true;
        break;
      default:
        return 'Unknown argument.';
    }
  }
  if (staging === undefined) return '--staging is required.';
  if (resumeFlag && cleanupFlag) return 'Use either --resume or --cleanup, not both.';
  // `pnpm --filter … run` changes the working directory; relative paths mean the caller's folder.
  const base = process.env.INIT_CWD ?? process.cwd();
  return { staging: resolve(base, staging), config: resolve(base, config), resume: resumeFlag, cleanup: cleanupFlag, headless };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    console.error(USAGE);
    return 2;
  }
  const log = (line: string): void => {
    console.log(line);
  };

  if (args.cleanup) return (await cleanup(args.staging, log)).exitCode;

  let config: DirectoryConfig;
  try {
    config = await loadConfig(args.config);
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'Invalid collector config: file');
    return 2;
  }

  const controller = new AbortController();
  const onSigint = (): void => {
    controller.abort();
  };
  process.on('SIGINT', onSigint);
  const input = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  const waiting: (() => void)[] = [];
  input.on('line', (line) => {
    const next = waiting.shift();
    if (next === undefined) lines.push(line);
    else next();
  });
  // Closing input (end of file) at a sign-in prompt is a cancellation.
  input.on('close', () => {
    controller.abort();
  });

  const waitForSignIn = (message: string): Promise<void> => {
    log(message);
    if (lines.shift() !== undefined) return Promise.resolve();
    return new Promise((resolveLine) => waiting.push(resolveLine));
  };

  try {
    const result = await collect({
      stagingDir: args.staging,
      config,
      mode: args.resume ? 'resume' : 'new',
      browser: { headless: args.headless },
      waitForSignIn,
      log,
      signal: controller.signal,
    });
    return result.exitCode;
  } finally {
    process.off('SIGINT', onSigint);
    input.removeAllListeners('close');
    input.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // Never echo an exception: it may carry page text or URLs.
    console.error('Collection failed.');
    process.exitCode = 1;
  },
);
