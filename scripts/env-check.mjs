#!/usr/bin/env node
// Toolchain check. Runs before `pnpm install`, so it must stay dependency-free
// and use only syntax that older Node versions can parse (so they can report
// themselves as too old rather than crash).
//
// Requirements come from the repo: `.node-version`, and `packageManager` /
// `engines` in the root package.json.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parse `26.12.0`, `v26.12.0`, `26.12.0-nightly`, or a partial `27` / `27.1`.
 * Returns null for anything else.
 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = VERSION_PATTERN.exec(text.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ?? null,
  };
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const COMPARATORS = {
  '>=': (c) => c >= 0,
  '>': (c) => c > 0,
  '<=': (c) => c <= 0,
  '<': (c) => c < 0,
  '=': (c) => c === 0,
};

/**
 * Supports the space-separated comparator sets used in `engines`, e.g. `>=26.12.0 <27`.
 * Returns null if the range cannot be parsed.
 */
function parseRange(range) {
  if (typeof range !== 'string' || range.trim() === '') return null;
  const comparators = [];
  for (const part of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
    const version = match ? parseVersion(match[2]) : null;
    if (!match || !version || version.prerelease !== null) return null;
    comparators.push({ test: COMPARATORS[match[1] ?? '='], version });
  }
  return comparators;
}

const INSTALL_HINTS = {
  node: (pinned) =>
    `Install Node ${pinned} (the version in .node-version), e.g. \`fnm install\`, \`mise install\`, or from https://nodejs.org/.`,
  pnpm: (pinned) =>
    `Install pnpm ${pinned} (the packageManager in package.json), e.g. \`npm install -g pnpm@${pinned}\`; see https://pnpm.io/installation.`,
};

function checkTool(tool, requirement, found) {
  const problem = (reason) => ({
    tool,
    required: requirement.range,
    found,
    message: `${tool}: ${reason}; required ${requirement.range}`,
    hint: INSTALL_HINTS[tool](requirement.pinned),
  });

  const range = parseRange(requirement.range);
  if (!range) return problem(`could not parse the required range "${String(requirement.range)}"`);
  if (found === null || found === undefined) return problem('not found on PATH');

  const version = parseVersion(found);
  if (!version) return problem(`could not parse version "${found}"`);
  // Prerelease builds (nightlies, release candidates) are always rejected: the
  // repo pins stable releases, and this keeps the result deterministic.
  if (version.prerelease !== null) return problem(`found prerelease ${found}, which is not supported`);
  if (!range.every(({ test, version: bound }) => test(compare(version, bound)))) {
    return problem(`found ${found}`);
  }
  return null;
}

/**
 * Pure comparison of required toolchain ranges against actual versions.
 *
 * @param {{ required: Record<'node'|'pnpm', { range: string, pinned: string }>,
 *           actual: Record<'node'|'pnpm', string | null> }} input
 * @returns {{ tool: string, required: string, found: string | null, message: string, hint: string }[]}
 */
export function checkToolchain({ required, actual }) {
  const problems = [];
  for (const tool of ['node', 'pnpm']) {
    const problem = checkTool(tool, required[tool], actual[tool]);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** Read the declared toolchain from `.node-version` and the root package.json in `rootDir`. */
export function readRequirements(rootDir) {
  const nodeVersion = readFileSync(join(rootDir, '.node-version'), 'utf8').trim().replace(/^v/, '');
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));

  const packageManager = /^pnpm@([^+]+)/.exec(pkg.packageManager ?? '');
  if (!packageManager) {
    throw new Error('package.json must declare "packageManager": "pnpm@<version>"');
  }
  const engines = pkg.engines ?? {};
  for (const tool of ['node', 'pnpm']) {
    if (typeof engines[tool] !== 'string') {
      throw new Error(`package.json must declare engines.${tool}`);
    }
  }

  return {
    node: { range: engines.node, pinned: nodeVersion },
    pnpm: { range: engines.pnpm, pinned: packageManager[1] },
  };
}

function installedPnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function main() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let required;
  try {
    required = readRequirements(rootDir);
  } catch (error) {
    console.error(`env-check: cannot read toolchain requirements: ${error.message}`);
    return 1;
  }

  const actual = { node: process.versions.node, pnpm: installedPnpmVersion() };
  const problems = checkToolchain({ required, actual });
  if (problems.length > 0) {
    console.error('env-check: toolchain problems found:');
    for (const problem of problems) {
      console.error(`  - ${problem.message}`);
      console.error(`    fix: ${problem.hint}`);
    }
    return 1;
  }
  console.log(`env-check: OK (node ${actual.node}, pnpm ${actual.pnpm})`);
  return 0;
}

// `import.meta.main` is not available on the older Node versions this must diagnose.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
