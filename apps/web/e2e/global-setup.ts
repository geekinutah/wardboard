import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { BASE_URL_ENV, GUI_CAPTURE_ENV, guiArtifactsDir, startCheckoutServer } from './checkout-server.ts';

const CAPTURE_SUFFIX = '.capture.ts';

/** Delete old images for every scenario in e2e/gui/ so stale screenshots never survive a run. */
async function clearScenarioArtifacts(): Promise<void> {
  const entries = await readdir(path.join(import.meta.dirname, 'gui'));
  const scenarios = entries.filter((name) => name.endsWith(CAPTURE_SUFFIX)).map((name) => name.slice(0, -CAPTURE_SUFFIX.length));
  await Promise.all(
    scenarios.map((scenario) => rm(path.join(guiArtifactsDir, scenario), { recursive: true, force: true })),
  );
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env[GUI_CAPTURE_ENV] === '1') await clearScenarioArtifacts();

  const server = await startCheckoutServer();
  process.env[BASE_URL_ENV] = server.url;

  // Global teardown: close the server and delete its temporary data directory.
  return async () => {
    await server.stop();
  };
}
