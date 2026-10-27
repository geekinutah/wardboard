import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const pinnedPnpm = JSON.parse(read('package.json')).packageManager.split('@')[1];

/**
 * YAML-lite scan: collect the items of every `ports:` list in the document
 * (no dependencies allowed for structural tests).
 */
function portsEntries(text) {
  const lines = text.split('\n');
  const entries = [];
  let collecting = false;
  let keyIndent = -1;
  for (const line of lines) {
    if (!collecting) {
      const key = /^(\s*)ports:\s*$/.exec(line);
      if (key !== null) {
        collecting = true;
        keyIndent = key[1].length;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.search(/\S/);
    if (indent <= keyIndent) {
      collecting = false;
      continue;
    }
    if (!trimmed.startsWith('-')) {
      collecting = false;
      continue;
    }
    entries.push(line.trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
  }
  return entries;
}

describe('docker/Dockerfile', () => {
  it('Dockerfile Node version matches .node-version', () => {
    const nodeVersion = read('.node-version').trim().replace(/^v/, '');
    const [major, minor] = nodeVersion.split('.');
    const froms = [...read('docker/Dockerfile').matchAll(/^FROM\s+(?:--platform=\S+\s+)?node:(\S+)/gm)].map(
      (m) => m[1],
    );

    assert.ok(froms.length >= 2, `expected at least two build stages, found: ${froms.join(', ')}`);
    for (const tag of froms) {
      const match = /^v?(\d+)\.(\d+)/.exec(tag);
      assert.ok(match !== null, `unrecognizable Node base tag: ${tag}`);
      assert.equal(
        `${match[1]}.${match[2]}`,
        `${major}.${minor}`,
        `FROM node:${tag} does not agree with .node-version (${nodeVersion})`,
      );
    }
  });

  it('Dockerfile pins pnpm to packageManager', () => {
    const text = read('docker/Dockerfile');
    const args = [...text.matchAll(/^\s*ARG\s+PNPM_VERSION=(\S+)/gm)].map((m) => m[1]);

    assert.ok(args.length > 0, 'Dockerfile declares no PNPM_VERSION build arg');
    for (const version of args) {
      assert.equal(version, pinnedPnpm, `PNPM_VERSION ${version} drifts from packageManager pnpm@${pinnedPnpm}`);
    }
    // The version must come from the arg, not a second hand-written literal.
    assert.match(text, /npm install -g pnpm@\$\{PNPM_VERSION\}/, 'pnpm must be installed from ${PNPM_VERSION}');
  });

  it('Dockerfile runs as non-root with a health check and /data volume', () => {
    const text = read('docker/Dockerfile');

    const users = [...text.matchAll(/^\s*USER\s+(\S+)/gm)].map((m) => m[1]);
    assert.ok(users.length > 0, 'Dockerfile sets no USER directive');
    for (const user of users) {
      const name = user.split(':')[0];
      assert.notEqual(name, 'root', `runtime USER must not be root (found ${user})`);
      assert.notEqual(name, '0', `runtime USER must not be uid 0 (found ${user})`);
    }

    assert.match(text, /^\s*HEALTHCHECK\b/m, 'missing HEALTHCHECK');
    assert.match(text, /^\s*VOLUME\s+\/data\b/m, 'missing VOLUME /data');
    assert.match(text, /WARDBOARD_DATA_DIR=\/data/, 'WARDBOARD_DATA_DIR must default to /data');
  });
});

describe('docker/compose.yaml', () => {
  it('compose publishes only on loopback', () => {
    const entries = portsEntries(read('docker/compose.yaml'));

    assert.ok(entries.length >= 1, 'compose service declares no ports');
    for (const entry of entries) {
      assert.ok(entry.startsWith('127.0.0.1:'), `port entry "${entry}" is not loopback-only`);
    }
  });

  it('compose keeps data in the wardboard-data volume and restarts unless-stopped', () => {
    const text = read('docker/compose.yaml');

    assert.match(text, /wardboard-data:\s*\/data/, 'wardboard-data must be mounted at /data');
    assert.match(text, /^\s*restart:\s*unless-stopped\s*$/m, 'restart policy must be unless-stopped');
  });
});

describe('.dockerignore', () => {
  it('dockerignore keeps fixtures, data and env out', () => {
    const entries = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    for (const required of ['node_modules', '**/node_modules', 'fixtures/', 'data/', '.env', 'apps/web/dist', 'docs/']) {
      assert.ok(entries.includes(required), `.dockerignore must list ${required}`);
    }
  });

  it('dockerignore excludes fixtures directories at any depth', () => {
    const entries = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    const idx = entries.findIndex((line) => line === '**/fixtures/' || line === '**/fixtures');
    assert.notEqual(
      idx,
      -1,
      '.dockerignore must list **/fixtures/ so fixtures/ directories at any depth (e.g. packages/core/src/fixtures/) stay out of the image',
    );

    for (const line of entries.slice(idx + 1)) {
      assert.ok(
        !line.startsWith('!') || !line.includes('fixtures'),
        `a later "${line}" re-includes fixtures after the ${entries[idx]} exclusion`,
      );
    }
  });
});

describe('scripts (docker edge cases)', () => {
  const smoke = join(import.meta.dirname, 'docker-smoke.sh');
  const setup = join(import.meta.dirname, 'setup.sh');
  const dirs = [];

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  /** Resolve a tool on the *current* test PATH (to seed the sandbox). */
  function toolPath(tool) {
    const result = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${tool} is not available in the test environment`);
    assert.ok(result.stdout.trim().length > 0, `${tool} is not available in the test environment`);
    return result.stdout.trim();
  }

  /**
   * A PATH that has the standard tools the scripts use — but deliberately no
   * `docker` — so the docker-missing branch runs deterministically.
   */
  function dockerlessPath(extraScripts = {}) {
    const bin = mkdtempSync(join(tmpdir(), 'wardboard-no-docker-'));
    dirs.push(bin);
    for (const tool of ['bash', 'sh', 'env', 'dirname']) {
      symlinkSync(toolPath(tool), join(bin, tool));
    }
    for (const [name, body] of Object.entries(extraScripts)) {
      writeFileSync(join(bin, name), body, { mode: 0o755 });
    }
    return bin;
  }

  it('docker-smoke.sh exits non-zero with a clear message when docker is missing', () => {
    const bin = dockerlessPath();
    const result = spawnSync(join(bin, 'bash'), [smoke], { encoding: 'utf8', env: { PATH: bin } });

    assert.notEqual(result.status, 0, `smoke must fail without docker: ${result.stdout}${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /docker/i, 'failure must name docker');
    assert.match(output, /OrbStack|Docker Engine/, 'failure must point at an install');
    // It must stop at the check, before doing any docker work.
    assert.doesNotMatch(output, /building image/i);
  });

  it('setup.sh prints a Docker hint but stays non-fatal when docker is missing', () => {
    const fakePnpm = `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo '${pinnedPnpm}'; exit 0; fi\nexit 0\n`;
    const bin = dockerlessPath({ pnpm: fakePnpm });
    symlinkSync(toolPath('node'), join(bin, 'node'));

    const result = spawnSync(join(bin, 'bash'), [setup], { encoding: 'utf8', env: { PATH: bin } });

    assert.equal(result.status, 0, `setup.sh must not fail when docker is missing: ${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /Docker not found/);
    assert.match(output, /OrbStack/);
  });
});
