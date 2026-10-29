import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANARIES, FIXTURE_NAMES, startDirectoryServer, type DirectoryServer } from './support/directory-server.ts';
import { bundleDir, rawFixtureConfig, removeTemp, tempStaging, workDir } from './support/run.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const SIGN_IN = 'Sign in to the directory in the browser window that opened, then press Enter here.';

type CliRun = { code: number | null; stdout: string; stderr: string };

/**
 * Runs the real `collect` entry point. When the sign-in prompt appears, it
 * either presses Enter or sends Ctrl-C (SIGINT).
 */
function runCli(args: string[], onPrompt: 'enter' | 'sigint' = 'enter'): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let prompted = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (!prompted && stdout.includes(SIGN_IN)) {
        prompted = true;
        if (onPrompt === 'enter') child.stdin.write('\n');
        else child.kill('SIGINT');
      }
    });
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

let server: DirectoryServer;
const temps: string[] = [];

async function staging(): Promise<string> {
  const dir = await tempStaging();
  temps.push(dir);
  return dir;
}

async function writeConfig(dir: string, edit: (raw: Record<string, unknown>) => void = () => undefined): Promise<string> {
  const raw = await rawFixtureConfig(server);
  edit(raw);
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify(raw));
  return path;
}

beforeEach(async () => {
  server = await startDirectoryServer();
});

afterEach(async () => {
  await server.close();
  for (const dir of temps.splice(0)) await removeTemp(dir);
});

describe('collect CLI', () => {
  it('the CLI prints counts, not names', async () => {
    const configDir = await staging();
    const dir = await staging();
    const config = await writeConfig(configDir);
    const run = await runCli(['--', '--staging', dir, '--config', config, '--headless']);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(SIGN_IN);
    expect(run.stdout).toContain(
      `Done. 8 portraits, 2 missing, 1 failed, 2 household images skipped. Bundle: ${bundleDir(dir)}`,
    );
    expect(run.stdout).toContain('Households 5 of 5');
    const output = run.stdout + run.stderr;
    for (const name of FIXTURE_NAMES) expect(output).not.toContain(name);
    for (const canary of CANARIES) expect(output).not.toContain(canary);
    expect(output).not.toContain(server.origin);

    // --cleanup through the CLI removes the collection.
    const cleaned = await runCli(['--staging', dir, '--cleanup']);
    expect(cleaned.code).toBe(0);
    expect(existsSync(workDir(dir))).toBe(false);
  });

  it('Ctrl-C at the sign-in prompt cancels with exit 1', async () => {
    const configDir = await staging();
    const dir = await staging();
    const config = await writeConfig(configDir);
    const run = await runCli(['--staging', dir, '--config', config, '--headless'], 'sigint');
    expect(run.code).toBe(1);
    expect(run.stdout).toContain(
      'Collection cancelled. Run again with --resume to continue or --cleanup to delete what was collected.',
    );
  });

  it('bad arguments, invalid config and refused staging exit 2', async () => {
    const configDir = await staging();
    const dir = await staging();

    const noStaging = await runCli(['--headless']);
    expect(noStaging.code).toBe(2);

    const both = await runCli(['--staging', dir, '--resume', '--cleanup']);
    expect(both.code).toBe(2);

    const unknown = await runCli(['--staging', dir, '--profile', 'x']);
    expect(unknown.code).toBe(2);

    const badConfig = await writeConfig(configDir, (raw) => {
      (raw.retries as Record<string, unknown>).image = 9;
    });
    const invalid = await runCli(['--staging', dir, '--config', badConfig, '--headless']);
    expect(invalid.code).toBe(2);
    expect(invalid.stdout + invalid.stderr).toContain('Invalid collector config: retries.image');

    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    const goodConfig = await writeConfig(configDir);
    const git = await runCli(['--staging', join(dir, 'repo', 'staging'), '--config', goodConfig, '--headless']);
    expect(git.code).toBe(2);
    expect(git.stdout + git.stderr).toContain('Choose a staging folder outside any Git repository.');
    expect(existsSync(join(dir, 'repo', 'staging'))).toBe(false);
    expect(existsSync(workDir(dir))).toBe(false);
    expect(server.requests).toEqual([]);
  });
});
