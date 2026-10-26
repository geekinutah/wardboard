import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const hook = join(import.meta.dirname, 'verify-hook.sh');

describe('verify-hook', () => {
  let dir;
  let marker;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wardboard-verify-hook-'));
    marker = join(dir, 'gate-ran');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A fake gate: records that it ran, prints `lines` numbered lines, exits `status`.
  function fakeGate({ status = 0, lines = 0 } = {}) {
    const script = join(dir, 'fake-gate.sh');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        `touch '${marker}'`,
        `for i in $(seq 1 ${lines}); do echo "gate output line $i"; done`,
        `exit ${status}`,
        '',
      ].join('\n'),
    );
    return `bash '${script}'`;
  }

  function runHook(input, verifyCmd) {
    return spawnSync('bash', [hook], {
      input,
      encoding: 'utf8',
      env: { ...process.env, WARDBOARD_VERIFY_CMD: verifyCmd },
    });
  }

  it('verify-hook exits 0 without running the gate when stop_hook_active is true', () => {
    const result = runHook('{"stop_hook_active":true}', fakeGate({ status: 1 }));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  });

  it("verify-hook honors Grok's stopHookActive", () => {
    const result = runHook('{"stopHookActive":true}', fakeGate({ status: 1 }));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  });

  it('verify-hook runs the gate when the active flag is false', () => {
    const result = runHook('{"stop_hook_active":false,"stopHookActive":false}', fakeGate());

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), true);
  });

  it('verify-hook exits 0 when the gate passes', () => {
    const result = runHook('{}', fakeGate({ status: 0, lines: 5 }));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), true);
  });

  it('verify-hook exits 2 with output tail when the gate fails', () => {
    const result = runHook('{}', fakeGate({ status: 1, lines: 100 }));

    assert.equal(result.status, 2);
    assert.equal(existsSync(marker), true);
    assert.match(result.stderr, /gate output line 100\n/);
    assert.match(result.stderr, /gate output line 41\n/);
    assert.doesNotMatch(result.stderr, /gate output line 40\n/);
    assert.doesNotMatch(result.stderr, /gate output line 1\n/);
  });

  it('verify-hook tolerates empty or invalid stdin', () => {
    for (const input of ['', 'not json', 'null', '[true]', '{"stop_hook_active":"true"}']) {
      rmSync(marker, { force: true });

      const result = runHook(input, fakeGate());

      assert.equal(result.status, 0, `input ${JSON.stringify(input)}: ${result.stderr}`);
      assert.equal(existsSync(marker), true, `gate should run for input ${JSON.stringify(input)}`);
    }
  });
});
