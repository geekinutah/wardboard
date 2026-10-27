import fs from 'node:fs';
import { access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fixtureIdentityProvider, startServer, type RunningServer } from '../src/index.ts';
import { seedFixtureDataDir, type SeededState } from './seed-data-dir.ts';

export type DevServerOptions = {
  dataDir: string;
  port: number;
  webDir: string;
  reset?: boolean;
};

export type DevRunningServer = RunningServer & { seeded: SeededState };

/** The fictional admin every client is signed in as. */
const DEV_ADMIN_LOGIN = 'dev-admin@example.test';
const DEV_ADMIN_NAME = 'Dev Admin';
/** Default `WARDBOARD_DEV_PORT` when the variable is unset. */
const DEFAULT_DEV_PORT = 5180;

/** The repository root: this file lives in `<repo>/apps/server/dev/`. */
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * `path.resolve` plus symlink resolution over the longest existing prefix.
 * `..` segments are resolved textually; symlinks are chased only through
 * ancestors that exist, so a directory that was already wiped (and has no
 * symlinked tail left to chase) still resolves to the real location.
 */
function fullyResolve(input: string): string {
  const resolved = path.resolve(input);
  const tail: string[] = [];
  let dir = resolved;
  for (;;) {
    if (fs.existsSync(dir)) {
      const real = fs.realpathSync(dir);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    }
    const parent = path.dirname(dir);
    if (parent === dir) return resolved;
    const base = path.basename(dir);
    if (base !== '') tail.push(base);
    dir = parent;
  }
}

/**
 * The only paths `--reset` may delete: exactly `<repo>/data/dev`, or strictly
 * inside the OS temp dir. `..` segments and symlinks in existing parents are
 * resolved before comparing, and the temp dir itself (not strictly inside) is
 * refused.
 */
export function isSafeResetPath(dataDir: string): boolean {
  const resolved = fullyResolve(dataDir);
  if (resolved === fullyResolve(path.join(repoRoot, 'data', 'dev'))) return true;
  const tempRoot = fullyResolve(os.tmpdir());
  return resolved !== tempRoot && resolved.startsWith(`${tempRoot}${path.sep}`);
}

/**
 * `WARDBOARD_DEV_PORT` as an integer from 1 to 65535.
 * Unset (`undefined`) defaults to 5180; anything else throws.
 */
export function parseDevPort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DEV_PORT;
  const port = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WARDBOARD_DEV_PORT must be an integer from 1 to 65535 (got "${raw}")`);
  }
  return port;
}

/**
 * Starts a loopback-only dev server over `dataDir`, seeding the fictional
 * fixture ward when the data dir does not hold a Current board yet. With
 * `reset`, the data dir is wiped first — and only when `isSafeResetPath`
 * accepts it — then reseeded. Everyone is signed in as the fictional Dev Admin.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevRunningServer> {
  if (options.reset) {
    if (!isSafeResetPath(options.dataDir)) {
      throw new Error(
        `Refusing to reset "${options.dataDir}": only <repo>/data/dev or a directory strictly inside the OS temp dir may be wiped`,
      );
    }
    await rm(options.dataDir, { recursive: true, force: true });
  }
  const seeded = seedFixtureDataDir(options.dataDir);
  const server = await startServer(
    {
      dataDir: options.dataDir,
      baseUrl: 'http://127.0.0.1',
      port: options.port,
      host: '127.0.0.1',
      webDir: options.webDir,
      initialAdminLogin: DEV_ADMIN_LOGIN,
    },
    {
      identityProvider: fixtureIdentityProvider({ login: DEV_ADMIN_LOGIN, displayName: DEV_ADMIN_NAME }),
    },
  );
  return { ...server, seeded };
}

function isRunDirectly(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const reset = process.argv.slice(2).includes('--reset');

  let port: number;
  try {
    port = parseDevPort(process.env['WARDBOARD_DEV_PORT']);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'WARDBOARD_DEV_PORT is invalid');
    process.exit(1);
  }

  const webDir = path.join(repoRoot, 'apps', 'web', 'dist');
  try {
    await access(path.join(webDir, 'index.html'));
  } catch {
    console.error(`No web build at ${webDir}. Run the build first: pnpm --filter @wardboard/web run build`);
    process.exit(1);
  }

  let running: DevRunningServer;
  try {
    running = await startDevServer({
      dataDir: path.join(repoRoot, 'data', 'dev'),
      port,
      webDir,
      reset,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'WardBoard dev failed to start');
    process.exit(1);
  }

  console.log(`WardBoard dev: ${running.url} (fictional data, signed in as Dev Admin)`);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void running.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isRunDirectly()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'WardBoard dev failed to start');
    process.exit(1);
  });
}
