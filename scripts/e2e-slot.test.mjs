import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const wrapper = join(import.meta.dirname, 'e2e-slot.pl');
const webPackage = join(import.meta.dirname, '..', 'apps', 'web', 'package.json');

// Safety net only: tests wait on printed output, and this bounds a hang.
const WAIT_LIMIT_MS = 20_000;

describe('e2e-slot', () => {
  let dir;
  let slotDir;
  let fake;
  let children;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wardboard-e2e-slot-'));
    slotDir = join(dir, 'slots');
    fake = join(dir, 'fake-playwright.mjs');
    // A fake command: prints its pid and arguments, then runs until the test
    // writes "exit" to its stdin, closes stdin, or kills it.
    writeFileSync(
      fake,
      [
        'process.stdout.write(`READY ${process.pid} ${JSON.stringify(process.argv.slice(2))}\\n`);',
        "process.stdin.on('data', (d) => { if (String(d).includes('exit')) process.exit(0); });",
        "process.stdin.on('end', () => process.exit(0));",
        '',
      ].join('\n'),
    );
    children = [];
  });

  afterEach(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function baseEnv(env) {
    const out = { ...process.env, WARDBOARD_E2E_SLOT_DIR: slotDir };
    delete out.WARDBOARD_E2E_SLOTS;
    delete out.WARDBOARD_E2E_WORKERS;
    return { ...out, ...env };
  }

  function track(child) {
    const run = { child, pid: child.pid, out: { stdout: '', stderr: '' }, waiters: [] };
    const notify = () => {
      for (const w of [...run.waiters]) w();
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      run.out.stdout += d;
      notify();
    });
    child.stderr.on('data', (d) => {
      run.out.stderr += d;
      notify();
    });
    child.on('error', (error) => {
      run.status = { error: error.message };
      notify();
    });
    run.exited = new Promise((resolve) => {
      child.on('close', (code, signal) => {
        run.status = { code, signal };
        notify();
        resolve(run.status);
      });
    });
    children.push(child);
    return run;
  }

  // Start the wrapper with the fake command and the given extra arguments.
  function startWrapper(args = [], env = {}) {
    const child = spawn(wrapper, [process.execPath, fake, ...args], {
      env: baseEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return track(child);
  }

  function runWrapperSync(args, env = {}) {
    return spawnSync(wrapper, args, {
      env: baseEnv(env),
      input: '',
      encoding: 'utf8',
      timeout: WAIT_LIMIT_MS,
    });
  }

  // Resolve with the match once `stream` output matches `pattern`; reject if
  // the process closes first.
  function waitFor(run, stream, pattern) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const m = run.out[stream].match(pattern);
        if (m) {
          done();
          resolve(m);
        } else if (run.status) {
          done();
          reject(
            new Error(
              `process closed (${JSON.stringify(run.status)}) before ${stream} matched ${pattern}\n` +
                `stdout: ${run.out.stdout}\nstderr: ${run.out.stderr}`,
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`timed out waiting for ${stream} to match ${pattern}\nstderr: ${run.out.stderr}`));
      }, WAIT_LIMIT_MS);
      const done = () => {
        clearTimeout(timer);
        run.waiters = run.waiters.filter((w) => w !== check);
      };
      run.waiters.push(check);
      check();
    });
  }

  async function ready(run) {
    const m = await waitFor(run, 'stdout', /READY (\d+) (.*)\n/);
    return { pid: Number(m[1]), args: JSON.parse(m[2]) };
  }

  async function slotOf(run) {
    const m = await waitFor(run, 'stderr', /e2e-slot: slot (\d+) acquired, workers=(\d+)\n/);
    return Number(m[1]);
  }

  async function finish(run) {
    run.child.stdin.end('exit\n');
    return run.exited;
  }

  // Can a separate process take a non-blocking exclusive flock on `file`?
  function canLock(file) {
    const result = spawnSync(
      'perl',
      [
        '-MFcntl=:flock',
        '-e',
        'open(my $fh, "+<", $ARGV[0]) or die "open: $!"; exit(flock($fh, LOCK_EX | LOCK_NB) ? 0 : 1)',
        file,
      ],
      { encoding: 'utf8' },
    );
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return result.status === 0;
  }

  // A separate process that holds the flock on `file` until its stdin closes.
  async function holdLock(file) {
    const child = spawn(
      'perl',
      [
        '-MFcntl=:flock',
        '-e',
        'open(my $fh, ">>", $ARGV[0]) or die "open: $!"; flock($fh, LOCK_EX) or die "flock: $!"; $| = 1; print "HELD\\n"; <STDIN>;',
        file,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const run = track(child);
    await waitFor(run, 'stdout', /HELD\n/);
    return run;
  }

  it('runs the command with --workers appended', async () => {
    const first = startWrapper(['test', '-c', 'cfg.ts', 'spec one.ts']);
    assert.deepEqual((await ready(first)).args, ['test', '-c', 'cfg.ts', 'spec one.ts', '--workers=6']);
    assert.match(first.out.stderr, /e2e-slot: slot 0 acquired, workers=6\n/);
    assert.deepEqual(await finish(first), { code: 0, signal: null });

    const second = startWrapper(['test', 'x'], { WARDBOARD_E2E_WORKERS: '3' });
    assert.deepEqual((await ready(second)).args, ['test', 'x', '--workers=3']);
    assert.match(second.out.stderr, /e2e-slot: slot 0 acquired, workers=3\n/);
    assert.deepEqual(await finish(second), { code: 0, signal: null });
  });

  it('execs instead of spawning a child', async () => {
    const run = startWrapper();
    assert.equal((await ready(run)).pid, run.pid);
    await finish(run);
  });

  it('the command holds the slot lock', async () => {
    const run = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await ready(run);
    assert.equal(canLock(join(slotDir, 'slot-0')), false);
    await finish(run);
    assert.equal(canLock(join(slotDir, 'slot-0')), true);
  });

  it('S runs hold S different slots', async () => {
    // slotDir does not exist yet: both wrappers race to create it.
    assert.equal(existsSync(slotDir), false);
    const a = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    const b = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await Promise.all([ready(a), ready(b)]);
    const slots = [await slotOf(a), await slotOf(b)].sort();
    assert.deepEqual(slots, [0, 1]);
    assert.doesNotMatch(a.out.stderr + b.out.stderr, /busy/);
    await Promise.all([finish(a), finish(b)]);
  });

  it('a run waits while every slot is busy', async () => {
    const first = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await ready(first);
    const second = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await waitFor(second, 'stderr', /e2e-slot: all 1 slots busy, waiting\n/);
    assert.equal(second.out.stdout, '');
    assert.doesNotMatch(second.out.stderr, /acquired/);
    assert.equal(second.status, undefined);
    await finish(first);
    await ready(second);
    await finish(second);
  });

  it('a waiting run starts when a slot frees', async () => {
    const first = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    const other = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await Promise.all([ready(first), ready(other)]);
    const freed = await slotOf(first);
    const waiting = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await waitFor(waiting, 'stderr', /e2e-slot: all 2 slots busy, waiting\n/);
    assert.deepEqual(await finish(first), { code: 0, signal: null });
    await ready(waiting);
    assert.equal(await slotOf(waiting), freed);
    await Promise.all([finish(other), finish(waiting)]);
  });

  it('a killed holder frees its slot', async () => {
    const first = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await ready(first);
    const waiting = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await waitFor(waiting, 'stderr', /e2e-slot: all 1 slots busy, waiting\n/);
    first.child.kill('SIGKILL');
    assert.equal((await first.exited).signal, 'SIGKILL');
    await ready(waiting);
    assert.equal(await slotOf(waiting), 0);
    await finish(waiting);
  });

  it('takes a free slot when another is busy', async () => {
    const first = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await ready(first);
    await finish(first);
    const holder = await holdLock(join(slotDir, 'slot-0'));
    const run = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await ready(run);
    assert.equal(await slotOf(run), 1);
    assert.doesNotMatch(run.out.stderr, /busy/);
    await finish(run);
    holder.child.stdin.end();
    await holder.exited;
  });

  it('creates the directory and slot files and keeps them', async () => {
    assert.equal(existsSync(slotDir), false);
    const run = startWrapper([], { WARDBOARD_E2E_SLOTS: '3' });
    await ready(run);
    for (const i of [0, 1, 2]) assert.equal(existsSync(join(slotDir, `slot-${i}`)), true);
    assert.deepEqual(await finish(run), { code: 0, signal: null });
    for (const i of [0, 1, 2]) assert.equal(existsSync(join(slotDir, `slot-${i}`)), true);
  });

  it('existing slot files are reused untouched', async () => {
    const first = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await ready(first);
    await finish(first);
    writeFileSync(join(slotDir, 'slot-0'), 'keep me\n');
    writeFileSync(join(slotDir, 'slot-1'), 'and me\n');
    const run = startWrapper([], { WARDBOARD_E2E_SLOTS: '2' });
    await ready(run);
    assert.equal(await slotOf(run), 0);
    await finish(run);
    assert.equal(readFileSync(join(slotDir, 'slot-0'), 'utf8'), 'keep me\n');
    assert.equal(readFileSync(join(slotDir, 'slot-1'), 'utf8'), 'and me\n');
  });

  it('refuses invalid sizes', () => {
    for (const name of ['WARDBOARD_E2E_SLOTS', 'WARDBOARD_E2E_WORKERS']) {
      for (const value of ['0', '-1', 'abc']) {
        const result = runWrapperSync([process.execPath, fake, 'test'], { [name]: value });
        assert.equal(result.status, 2, `${name}=${value}: ${result.stderr}`);
        assert.match(result.stderr, new RegExp(name));
        assert.doesNotMatch(result.stdout, /READY/);
      }
    }
  });

  it('refuses a caller-supplied worker count', () => {
    for (const flags of [['--workers', '4'], ['--workers=4'], ['-j', '4'], ['-j4']]) {
      const result = runWrapperSync([process.execPath, fake, 'test', ...flags]);
      assert.equal(result.status, 2, `${flags.join(' ')}: ${result.stderr}`);
      assert.match(result.stderr, /e2e-slot: .*worker/);
      assert.doesNotMatch(result.stdout, /READY/);
    }
  });

  it('usage error with no command', () => {
    const result = runWrapperSync([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: .*e2e-slot\.pl <command>/i);
  });

  it('reports a command that cannot run', async () => {
    const result = runWrapperSync([join(dir, 'no-such-command'), 'test'], { WARDBOARD_E2E_SLOTS: '1' });
    assert.equal(result.status, 127, result.stderr);
    assert.match(result.stderr, /e2e-slot: slot 0 acquired/);
    assert.match(result.stderr, /no-such-command/);

    const next = startWrapper([], { WARDBOARD_E2E_SLOTS: '1' });
    await ready(next);
    assert.equal(await slotOf(next), 0);
    assert.doesNotMatch(next.out.stderr, /busy/);
    await finish(next);
  });

  it('e2e scripts go through the wrapper', () => {
    const { scripts } = JSON.parse(readFileSync(webPackage, 'utf8'));
    assert.equal(
      scripts['test:e2e:playwright'],
      'pnpm run build && ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts',
    );
    assert.equal(
      scripts['gui:capture'],
      'pnpm run build && WARDBOARD_GUI_CAPTURE=1 ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts',
    );
  });
});
