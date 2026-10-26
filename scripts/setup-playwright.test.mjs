import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const setup = join(import.meta.dirname, 'setup.sh');
const workflowPath = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
const pinnedPnpm = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
  .packageManager.split('@')[1];

describe('setup.sh Playwright browsers', () => {
  let dir;
  let log;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wardboard-setup-'));
    log = join(dir, 'pnpm-calls.log');
    // A fake pnpm on PATH: reports the pinned version, records every other call, succeeds.
    const fakePnpm = join(dir, 'pnpm');
    writeFileSync(
      fakePnpm,
      [
        '#!/usr/bin/env bash',
        `if [ "$1" = "--version" ]; then echo '${pinnedPnpm}'; exit 0; fi`,
        `echo "$*" >> '${log}'`,
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(fakePnpm, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runSetup(extraEnv) {
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` };
    delete env.WARDBOARD_PLAYWRIGHT_WITH_DEPS;
    Object.assign(env, extraEnv);
    const result = spawnSync('bash', [setup], { encoding: 'utf8', env });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    return { result, calls };
  }

  it('setup installs Playwright Chromium and WebKit after dependencies', () => {
    const { result, calls } = runSetup({});

    assert.equal(result.status, 0, result.stderr);
    const install = calls.findIndex((c) => c.startsWith('install'));
    const browsers = calls.findIndex((c) => c === '--filter web exec playwright install chromium webkit');
    assert.ok(install !== -1, `calls: ${calls.join(' | ')}`);
    assert.ok(browsers > install, `calls: ${calls.join(' | ')}`);
  });

  it('setup adds --with-deps only when WARDBOARD_PLAYWRIGHT_WITH_DEPS=1', () => {
    const withDeps = runSetup({ WARDBOARD_PLAYWRIGHT_WITH_DEPS: '1' });
    assert.equal(withDeps.result.status, 0, withDeps.result.stderr);
    assert.ok(
      withDeps.calls.includes('--filter web exec playwright install --with-deps chromium webkit'),
      `calls: ${withDeps.calls.join(' | ')}`,
    );

    rmSync(log, { force: true });
    const without = runSetup({ WARDBOARD_PLAYWRIGHT_WITH_DEPS: '0' });
    assert.equal(without.result.status, 0, without.result.stderr);
    assert.ok(!without.calls.some((c) => c.includes('--with-deps')), `calls: ${without.calls.join(' | ')}`);
  });

  it('ci workflow sets WARDBOARD_PLAYWRIGHT_WITH_DEPS=1 for the setup step', () => {
    const text = readFileSync(workflowPath, 'utf8');
    const lines = text.split('\n');
    const setupLine = lines.findIndex((line) => /^\s+run:\s*\.\/scripts\/setup\.sh\s*$/.test(line));
    assert.ok(setupLine !== -1, 'setup step exists');
    // The env must belong to the same step: search from the step's `- name:` to the next step.
    let start = setupLine;
    while (start > 0 && !/^\s+-\s/.test(lines[start])) start -= 1;
    let end = setupLine + 1;
    while (end < lines.length && !/^\s+-\s/.test(lines[end])) end += 1;
    const step = lines.slice(start, end).join('\n');
    assert.match(step, /WARDBOARD_PLAYWRIGHT_WITH_DEPS:\s*['"]?1['"]?/);
  });
});
