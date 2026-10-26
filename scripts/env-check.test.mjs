import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { checkToolchain, readRequirements } from './env-check.mjs';

const required = {
  node: { range: '>=26.12.0 <27', pinned: '26.12.0' },
  pnpm: { range: '>=12.4.2 <13', pinned: '12.4.2' },
};

function problemsFor(actual) {
  return checkToolchain({ required, actual });
}

describe('checkToolchain', () => {
  it('checkToolchain accepts matching versions', () => {
    assert.deepEqual(problemsFor({ node: '26.12.0', pnpm: '12.4.2' }), []);
  });

  it('checkToolchain accepts newer versions inside the declared ranges', () => {
    assert.deepEqual(problemsFor({ node: '26.13.1', pnpm: '12.9.0' }), []);
  });

  it('checkToolchain rejects an older Node', () => {
    const problems = problemsFor({ node: '24.11.0', pnpm: '12.4.2' });

    assert.equal(problems.length, 1);
    const [problem] = problems;
    assert.equal(problem.tool, 'node');
    assert.equal(problem.required, '>=26.12.0 <27');
    assert.equal(problem.found, '24.11.0');
    assert.match(problem.message, /node/);
    assert.match(problem.message, />=26\.12\.0 <27/);
    assert.match(problem.message, /24\.11\.0/);
    assert.match(problem.hint, /26\.12\.0/);
  });

  it('checkToolchain rejects an older minor of the same Node major', () => {
    const problems = problemsFor({ node: '26.11.9', pnpm: '12.4.2' });

    assert.deepEqual(
      problems.map((p) => p.tool),
      ['node'],
    );
  });

  it('checkToolchain rejects the next Node major', () => {
    const problems = problemsFor({ node: '27.0.0', pnpm: '12.4.2' });

    assert.deepEqual(
      problems.map((p) => [p.tool, p.found]),
      [['node', '27.0.0']],
    );
  });

  it('checkToolchain rejects a different pnpm major', () => {
    for (const pnpm of ['11.9.0', '13.0.0']) {
      const problems = problemsFor({ node: '26.12.0', pnpm });

      assert.equal(problems.length, 1, `pnpm ${pnpm}`);
      const [problem] = problems;
      assert.equal(problem.tool, 'pnpm');
      assert.equal(problem.required, '>=12.4.2 <13');
      assert.equal(problem.found, pnpm);
      assert.match(problem.hint, /12\.4\.2/);
    }
  });

  it('checkToolchain reports missing pnpm', () => {
    let problems;
    assert.doesNotThrow(() => {
      problems = problemsFor({ node: '26.12.0', pnpm: null });
    });

    assert.equal(problems.length, 1);
    const [problem] = problems;
    assert.equal(problem.tool, 'pnpm');
    assert.equal(problem.found, null);
    assert.match(problem.message, /not found/);
    assert.match(problem.hint, /install/i);
    assert.match(problem.hint, /pnpm@12\.4\.2/);
  });

  it('checkToolchain reports both tools when both are wrong', () => {
    const problems = problemsFor({ node: '22.0.0', pnpm: null });

    assert.deepEqual(
      problems.map((p) => p.tool),
      ['node', 'pnpm'],
    );
  });

  it('checkToolchain accepts a leading v in version strings', () => {
    assert.deepEqual(problemsFor({ node: 'v26.12.0', pnpm: 'v12.4.2' }), []);
    assert.equal(problemsFor({ node: 'v24.0.0', pnpm: '12.4.2' }).length, 1);
  });

  it('checkToolchain deterministically rejects prerelease builds such as nightlies', () => {
    for (const node of ['26.12.0-nightly', '26.13.0-nightly20261020abcdef']) {
      const first = problemsFor({ node, pnpm: '12.4.2' });
      const second = problemsFor({ node, pnpm: '12.4.2' });

      assert.deepEqual(first, second);
      assert.equal(first.length, 1, node);
      assert.equal(first[0].tool, 'node');
      assert.equal(first[0].found, node);
      assert.match(first[0].message, /prerelease/);
    }
  });

  it('checkToolchain reports unparseable versions instead of throwing', () => {
    const problems = problemsFor({ node: 'banana', pnpm: '' });

    assert.deepEqual(
      problems.map((p) => p.tool),
      ['node', 'pnpm'],
    );
    assert.match(problems[0].message, /could not parse/);
  });
});

describe('readRequirements', () => {
  const dirs = [];

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function repoWith({ nodeVersion, packageJson }) {
    const dir = mkdtempSync(join(tmpdir(), 'wardboard-env-check-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.node-version'), nodeVersion);
    writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson));
    return dir;
  }

  it('checkToolchain reads requirements from repo files', () => {
    const dir = repoWith({
      nodeVersion: '26.12.0\n',
      packageJson: {
        packageManager: 'pnpm@12.4.2',
        engines: { node: '>=26.12.0 <27', pnpm: '>=12.4.2 <13' },
      },
    });

    assert.deepEqual(readRequirements(dir), required);

    const changed = repoWith({
      nodeVersion: 'v28.1.0\n',
      packageJson: {
        packageManager: 'pnpm@14.0.1+sha512.abc',
        engines: { node: '>=28.1.0 <29', pnpm: '>=14.0.1 <15' },
      },
    });
    const changedRequirements = readRequirements(changed);

    assert.deepEqual(changedRequirements, {
      node: { range: '>=28.1.0 <29', pinned: '28.1.0' },
      pnpm: { range: '>=14.0.1 <15', pinned: '14.0.1' },
    });
    assert.equal(
      checkToolchain({ required: changedRequirements, actual: { node: '26.12.0', pnpm: '12.4.2' } }).length,
      2,
    );
  });

  it('readRequirements fails with a clear message when declarations are missing', () => {
    const dir = repoWith({ nodeVersion: '26.12.0\n', packageJson: { engines: { node: '>=26.12.0 <27' } } });

    assert.throws(() => readRequirements(dir), /packageManager/);
  });

  it('the repository declarations agree with the design requirements', () => {
    assert.deepEqual(readRequirements(join(import.meta.dirname, '..')), required);
  });
});
