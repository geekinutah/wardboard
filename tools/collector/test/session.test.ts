import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDirectoryServer, type DirectoryServer } from './support/directory-server.ts';
import {
  bundleDir,
  fixtureConfig,
  listFiles,
  readManifest,
  removeTemp,
  runCollector,
  tempStaging,
  workDir,
} from './support/run.ts';

const SIGN_IN = 'Sign in to the directory in the browser window that opened, then press Enter here.';
const EXPIRED = 'Sign-in expired. Sign in again in the browser window, then press Enter here.';

let server: DirectoryServer;
const temps: string[] = [];

async function staging(): Promise<string> {
  const dir = await tempStaging();
  temps.push(dir);
  return dir;
}

beforeEach(async () => {
  server = await startDirectoryServer();
});

afterEach(async () => {
  await server.close();
  for (const dir of temps.splice(0)) await removeTemp(dir);
});

/** The manifest text of an uninterrupted run against a fresh server. */
async function referenceManifest(): Promise<string> {
  const reference = await startDirectoryServer();
  const dir = await staging();
  try {
    const run = await runCollector(dir, await fixtureConfig(reference));
    expect(run.result.status).toBe('done');
    return (await readManifest(dir)).text;
  } finally {
    await reference.close();
  }
}

describe('sign-in and layout', () => {
  it('an unsupported layout fails without a bundle', async () => {
    const dir = await staging();
    const config = await fixtureConfig(server, (raw) => {
      (raw.selectors as Record<string, string>).householdList = 'ul.no-such-list';
      (raw.timeouts as Record<string, number>).elementMs = 1000;
    });
    const run = await runCollector(dir, config);
    const message = 'Unsupported directory layout (expected directory-v1). Nothing was imported.';
    expect(run.result).toEqual({ status: 'unsupported_layout', exitCode: 1, message });
    expect(run.logs).toContain(message);
    expect(run.signInMessages).toEqual([SIGN_IN]);
    expect(existsSync(join(bundleDir(dir), 'manifest.json'))).toBe(false);
    expect(await listFiles(dir)).toEqual([]);
  });

  it('an expired sign-in waits for the user and continues', async () => {
    const dir = await staging();
    const expected = await referenceManifest();
    let expired = false;
    const run = await runCollector(
      dir,
      await fixtureConfig(server),
      {},
      {
        onLog: (line) => {
          // After the second household, the next page load shows the signed-out page.
          if (!expired && line.startsWith('Households 2 of 5')) {
            expired = true;
            server.expireNextPage();
          }
        },
      },
    );
    expect(expired).toBe(true);
    expect(run.result.status).toBe('done');
    expect(run.signInMessages).toEqual([SIGN_IN, EXPIRED]);
    expect((await readManifest(dir)).text).toBe(expected);
  });
});

describe('cancellation and resume', () => {
  it('cancel then resume equals an uninterrupted run', async () => {
    const dir = await staging();
    const expected = await referenceManifest();
    const config = await fixtureConfig(server);
    const controller = new AbortController();
    const cancelled = await runCollector(
      dir,
      config,
      { signal: controller.signal },
      {
        onLog: (line) => {
          if (line.startsWith('Households 2 of 5')) controller.abort();
        },
      },
    );
    const cancelMessage =
      'Collection cancelled. Run again with --resume to continue or --cleanup to delete what was collected.';
    expect(cancelled.result).toEqual({ status: 'cancelled', exitCode: 1, message: cancelMessage });
    expect(cancelled.logs).toContain(cancelMessage);
    expect(existsSync(join(bundleDir(dir), 'manifest.json'))).toBe(false);
    const state = JSON.parse(await readFile(join(workDir(dir), 'state.json'), 'utf8')) as {
      completedHouseholds: number[];
      layoutVersion: string;
    };
    expect(state.completedHouseholds).toEqual([0, 1]);
    expect(state.layoutVersion).toBe('directory-v1');

    const firstHouseholdRequests = server.photoRequests('ada.png');
    expect(firstHouseholdRequests).toBe(1);

    const resumed = await runCollector(dir, config, { mode: 'resume' });
    expect(resumed.result).toMatchObject({ status: 'done', exitCode: 0 });
    // Completed households are not collected again.
    expect(server.photoRequests('ada.png')).toBe(1);
    expect(server.photoRequests('eli.png')).toBe(1);
    expect(server.photoRequests('cal-epsilon.png')).toBe(1);
    expect((await readManifest(dir)).text).toBe(expected);
    const resumedState = JSON.parse(await readFile(join(workDir(dir), 'state.json'), 'utf8')) as {
      completedHouseholds: number[];
    };
    expect(resumedState.completedHouseholds).toEqual([0, 1, 2, 3, 4]);
  });
});
