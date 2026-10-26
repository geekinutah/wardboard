import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '@wardboard/server';

/** Env var global setup uses to hand the server's bound URL to the workers. */
export const BASE_URL_ENV = 'WARDBOARD_E2E_BASE_URL';
/** Env var `gui:capture` sets to run only the e2e/gui/ capture scenarios. */
export const GUI_CAPTURE_ENV = 'WARDBOARD_GUI_CAPTURE';

const webRoot = path.resolve(import.meta.dirname, '..');
export const webDistDir = path.join(webRoot, 'dist');
export const guiArtifactsDir = path.join(webRoot, 'gui-artifacts');

export type CheckoutServer = {
  url: string;
  dataDir: string;
  stop(): Promise<void>;
};

/**
 * Seeding seam. Later tasks seed the fictional fixture ward into `dataDir`
 * here, before the server starts. Never seed real member data.
 */
export async function seedFixtureWard(dataDir: string): Promise<void> {
  // Intentionally a no-op until the board model and fixture ward exist.
  await Promise.resolve(dataDir);
}

/**
 * Start @wardboard/server in-process for this checkout only: an ephemeral port
 * on 127.0.0.1, a fresh temporary data directory, and the already-built
 * apps/web/dist as the web root. Builds nothing itself.
 */
export async function startCheckoutServer(): Promise<CheckoutServer> {
  try {
    await access(path.join(webDistDir, 'index.html'));
  } catch {
    throw new Error(`No web build at ${webDistDir}. Run \`pnpm --filter web run build\` first.`);
  }

  const dataDir = await mkdtemp(path.join(tmpdir(), 'wardboard-e2e-'));
  try {
    await seedFixtureWard(dataDir);
    const server = await startServer({
      dataDir,
      baseUrl: 'http://127.0.0.1',
      port: 0,
      host: '127.0.0.1',
      webDir: webDistDir,
    });
    return {
      url: server.url,
      dataDir,
      async stop() {
        try {
          await server.close();
        } finally {
          await rm(dataDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error: unknown) {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
