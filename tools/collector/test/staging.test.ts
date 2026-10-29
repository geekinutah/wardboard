import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../src/collect.ts';
import { ConfigError, loadConfig, parseConfig } from '../src/config.ts';
import { startDirectoryServer, type DirectoryServer } from './support/directory-server.ts';
import {
  bundleDir,
  fixtureConfig,
  listFiles,
  rawFixtureConfig,
  removeTemp,
  runCollector,
  tempStaging,
  workDir,
} from './support/run.ts';

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

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-10-01T12:00:00.000Z');

describe('staging folder', () => {
  it('refuses a staging folder inside a Git repository', async () => {
    const root = await staging();
    const message = 'Choose a staging folder outside any Git repository.';

    await mkdir(join(root, 'repo', '.git'), { recursive: true });
    const nested = join(root, 'repo', 'sub', 'photos');
    const config = await fixtureConfig(server);
    const run = await runCollector(nested, config);
    expect(run.result).toEqual({ status: 'refused', exitCode: 2, message });
    expect(run.logs).toEqual([message]);
    expect(run.signInMessages).toEqual([]);
    expect(existsSync(join(root, 'repo', 'sub'))).toBe(false);

    // The repository folder itself, and a `.git` file (a worktree) both count.
    const direct = await runCollector(join(root, 'repo'), config);
    expect(direct.result.exitCode).toBe(2);
    expect(existsSync(join(root, 'repo', 'wardboard-collector'))).toBe(false);

    await mkdir(join(root, 'worktree'));
    await writeFile(join(root, 'worktree', '.git'), 'gitdir: /elsewhere\n');
    const worktree = await runCollector(join(root, 'worktree', 'staging'), config);
    expect(worktree.result).toEqual({ status: 'refused', exitCode: 2, message });
    expect(existsSync(join(root, 'worktree', 'staging'))).toBe(false);
    expect(server.requests).toEqual([]);
  });

  it('refuses an existing collection without --resume or --cleanup', async () => {
    const dir = await staging();
    await mkdir(workDir(dir));
    await writeFile(join(workDir(dir), 'state.json'), '{}');
    const run = await runCollector(dir, await fixtureConfig(server));
    const message =
      'A previous collection exists in this folder. Run again with --resume to continue it or --cleanup to delete it.';
    expect(run.result).toEqual({ status: 'refused', exitCode: 2, message });
    expect(run.logs).toEqual([message]);
    expect(run.signInMessages).toEqual([]);
    expect(await readFile(join(workDir(dir), 'state.json'), 'utf8')).toBe('{}');
    expect(server.requests).toEqual([]);
  });

  it('creates a private work dir', async () => {
    const dir = await staging();
    const run = await runCollector(dir, await fixtureConfig(server));
    expect(run.result.status).toBe('done');
    expect((await stat(workDir(dir))).mode & 0o777).toBe(0o700);
    expect((await stat(bundleDir(dir))).mode & 0o777).toBe(0o700);
  });
});

describe('resume', () => {
  it('resume refuses old or different-layout state', async () => {
    const dir = await staging();
    const config = await fixtureConfig(server);
    const controller = new AbortController();
    const first = await runCollector(
      dir,
      config,
      { signal: controller.signal, now: () => T0 },
      {
        onLog: (line) => {
          if (line.startsWith('Households 1 of 5')) controller.abort();
        },
      },
    );
    expect(first.result.status).toBe('cancelled');
    const before = await listFiles(dir);

    const old = await runCollector(dir, config, { mode: 'resume', now: () => new Date(T0.getTime() + 8 * DAY) });
    const oldMessage = 'This collection is more than 7 days old. Run again with --cleanup to delete it.';
    expect(old.result).toEqual({ status: 'refused', exitCode: 2, message: oldMessage });
    expect(old.logs).toEqual([oldMessage]);
    expect(old.signInMessages).toEqual([]);

    const otherLayout = await fixtureConfig(server, (raw) => {
      raw.layoutVersion = 'directory-v2';
    });
    const layout = await runCollector(dir, otherLayout, { mode: 'resume', now: () => new Date(T0.getTime() + DAY) });
    const layoutMessage = 'This collection used a different directory layout. Run again with --cleanup to delete it.';
    expect(layout.result).toEqual({ status: 'refused', exitCode: 2, message: layoutMessage });
    expect(layout.signInMessages).toEqual([]);
    expect(await listFiles(dir)).toEqual(before);

    // Six days old is still within the retention bound.
    const fresh = await runCollector(dir, config, { mode: 'resume', now: () => new Date(T0.getTime() + 6 * DAY) });
    expect(fresh.result.status).toBe('done');
  });

  it('resume without a previous collection is refused', async () => {
    const dir = await staging();
    const run = await runCollector(dir, await fixtureConfig(server), { mode: 'resume' });
    expect(run.result.exitCode).toBe(2);
    expect(run.result.status).toBe('refused');
    expect(existsSync(workDir(dir))).toBe(false);
  });
});

describe('cleanup', () => {
  it('cleanup removes only collector files', async () => {
    const dir = await staging();
    const run = await runCollector(dir, await fixtureConfig(server));
    expect(run.result.status).toBe('done');
    const collected = await listFiles(workDir(dir));
    expect(collected).toContain('state.json');
    expect(collected).toContain(join('bundle', 'manifest.json'));
    expect(collected.length).toBe(9);

    await writeFile(join(dir, 'my-own-notes.txt'), 'user file');
    await mkdir(join(dir, 'my-photos'));
    await writeFile(join(dir, 'my-photos', 'keep.png'), 'user photo');
    await writeFile(join(workDir(dir), 'added-by-user.txt'), 'user file in work dir');

    const logs: string[] = [];
    const result = await cleanup(dir, (line) => logs.push(line));
    expect(result).toEqual({ exitCode: 0, deleted: 9, left: 1, failed: 0 });
    expect(logs).toContain(`Left 1 files that the collector did not create in ${workDir(dir)}.`);
    expect(logs.join('\n')).not.toContain('added-by-user');
    expect(await readFile(join(dir, 'my-own-notes.txt'), 'utf8')).toBe('user file');
    expect(await readFile(join(dir, 'my-photos', 'keep.png'), 'utf8')).toBe('user photo');
    expect(await listFiles(workDir(dir))).toEqual(['added-by-user.txt']);
    expect(existsSync(bundleDir(dir))).toBe(false);
  });

  it('cleanup of a cancelled run removes the work dir and leaves the staging parent', async () => {
    const dir = await staging();
    const controller = new AbortController();
    const run = await runCollector(
      dir,
      await fixtureConfig(server),
      { signal: controller.signal },
      {
        onLog: (line) => {
          if (line.startsWith('Households 1 of 5')) controller.abort();
        },
      },
    );
    expect(run.result.status).toBe('cancelled');
    expect((await listFiles(workDir(dir))).length).toBeGreaterThan(1);
    await writeFile(join(dir, 'unrelated.txt'), 'keep me');

    const logs: string[] = [];
    const result = await cleanup(dir, (line) => logs.push(line));
    expect(result.exitCode).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.left).toBe(0);
    expect(existsSync(workDir(dir))).toBe(false);
    expect(await readdir(dir)).toEqual(['unrelated.txt']);
  });

  it('a failed delete is reported with a count and can be retried', async () => {
    const dir = await staging();
    const run = await runCollector(dir, await fixtureConfig(server));
    expect(run.result.status).toBe('done');
    const bundleFiles = (await listFiles(bundleDir(dir))).length;
    expect(bundleFiles).toBe(8);

    await chmod(bundleDir(dir), 0o500);
    const logs: string[] = [];
    let result;
    try {
      result = await cleanup(dir, (line) => logs.push(line));
    } finally {
      await chmod(bundleDir(dir), 0o700);
    }
    expect(result).toMatchObject({ exitCode: 1, failed: bundleFiles });
    expect(logs).toContain(`Could not delete ${String(bundleFiles)} files in ${workDir(dir)}.`);
    // The record survives, so a second cleanup can finish the job.
    expect(existsSync(join(workDir(dir), 'state.json'))).toBe(true);

    const retry = await cleanup(dir, () => undefined);
    expect(retry).toEqual({ exitCode: 0, deleted: 9, left: 0, failed: 0 });
    expect(existsSync(workDir(dir))).toBe(false);
  });

  it('cleanup never deletes a path the state file points outside the work dir', async () => {
    const dir = await staging();
    await mkdir(workDir(dir));
    await writeFile(join(dir, 'precious.txt'), 'keep');
    await writeFile(
      join(workDir(dir), 'state.json'),
      JSON.stringify({
        layoutVersion: 'directory-v1',
        startedAt: T0.toISOString(),
        completedHouseholds: [],
        portraits: [],
        missing: [],
        skippedHousehold: 0,
        failed: 0,
        createdFiles: ['../precious.txt', '/etc/hosts', 'bundle/../../precious.txt'],
      }),
    );
    const result = await cleanup(dir, () => undefined);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, 'precious.txt'), 'utf8')).toBe('keep');
    expect(existsSync(workDir(dir))).toBe(false);
  });
});

describe('config', () => {
  it('invalid config is rejected', async () => {
    const cases: [string, (raw: Record<string, unknown>) => void][] = [
      ['startUrl', (raw) => (raw.startUrl = 'ftp://directory.example/')],
      ['startUrl', (raw) => (raw.startUrl = 'http://directory.example/')],
      ['selectors.memberName', (raw) => ((raw.selectors as Record<string, unknown>).memberName = '')],
      ['selectors.signedOut', (raw) => delete (raw.selectors as Record<string, unknown>).signedOut],
      ['retries.image', (raw) => ((raw.retries as Record<string, unknown>).image = 9)],
      ['retries.image', (raw) => ((raw.retries as Record<string, unknown>).image = 1.5)],
      ['timeouts.elementMs', (raw) => ((raw.timeouts as Record<string, unknown>).elementMs = 0)],
      ['layoutVersion', (raw) => (raw.layoutVersion = '')],
    ];
    for (const [field, edit] of cases) {
      const raw = await rawFixtureConfig(server);
      edit(raw);
      expect(() => parseConfig(raw), field).toThrow(ConfigError);
      let message = '';
      try {
        parseConfig(raw);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`Invalid collector config: ${field}`);
    }
    expect(() => parseConfig(null)).toThrow(ConfigError);

    // Loopback http is allowed for tests; https is the normal case.
    const loopback = await rawFixtureConfig(server);
    loopback.startUrl = 'http://localhost:9/signin';
    expect(parseConfig(loopback).startUrl).toBe('http://localhost:9/signin');
  });

  it('the shipped config is valid and points at the directory over https', async () => {
    const config = await loadConfig(new URL('../config/directory.json', import.meta.url).pathname);
    expect(config.layoutVersion).toBe('directory-v1');
    expect(new URL(config.startUrl).protocol).toBe('https:');
    expect(config.retries.image).toBeLessThanOrEqual(5);
  });
});

describe('source boundaries', () => {
  const srcDir = new URL('../src/', import.meta.url).pathname;

  async function sources(): Promise<[string, string][]> {
    const names = (await readdir(srcDir, { recursive: true })).filter((n) => n.endsWith('.ts'));
    return Promise.all(names.map(async (n) => [n, await readFile(join(srcDir, n), 'utf8')] as [string, string]));
  }

  it('the collector source uses no forbidden browser APIs', async () => {
    const files = await sources();
    expect(files.map(([n]) => n)).toEqual(expect.arrayContaining(['cli.ts', 'collect.ts', 'config.ts']));
    const forbidden = [
      'launchPersistentContext',
      'storageState',
      '.cookies(',
      'addCookies',
      'screenshot(',
      '.content(',
      '.pdf(',
      'tracing',
      'recordVideo',
      'recordHar',
    ];
    for (const [name, text] of files) {
      for (const api of forbidden) expect(text, `${name} uses ${api}`).not.toContain(api);
    }
  });

  it('the collector depends on no model SDK or AI service', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ playwright: '1.64.1' });
    expect(Object.keys(pkg.devDependencies)).toEqual(['vitest']);
    const modelHosts = /openai|anthropic|generativelanguage|googleapis|langchain|ollama|huggingface|cohere|mistral/i;
    for (const [name, text] of await sources()) expect(text, name).not.toMatch(modelHosts);
  });
});
