import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const repoRoot = join(import.meta.dirname, '..');
const guiDir = join(repoRoot, 'apps', 'web', 'e2e', 'gui');

function captureFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...captureFiles(full));
    else if (name.endsWith('.capture.ts')) found.push(full);
  }
  return found.sort();
}

function importStatements(source) {
  const statements = [];
  const lines = source.split('\n');
  let current = null;
  for (const line of lines) {
    if (current === null) {
      if (/^\s*import\s/.test(line)) current = line;
    } else {
      current += `\n${line}`;
    }
    if (current !== null && /;\s*(?:\/\/.*)?$/.test(line)) {
      statements.push(current);
      current = null;
    }
  }
  return statements;
}

function valueImports(statement) {
  const from = /from\s*['"]([^'"]+)['"]/.exec(statement);
  const specifier = from?.[1] ?? '';
  const names = [];
  const brace = /\{([\s\S]*)\}/.exec(statement);
  if (brace) {
    for (const part of brace[1].split(',')) {
      const trimmed = part.trim();
      if (trimmed === '' || trimmed.startsWith('type ')) continue;
      const [imported, local] = trimmed.split(/\s+as\s+/).map((piece) => piece.trim());
      names.push({ imported, local: local ?? imported });
    }
  } else {
    const def = /^import\s+(?!type\b)([A-Za-z_$][\w$]*)\s+from/.exec(statement);
    if (def?.[1] !== undefined) names.push({ imported: 'default', local: def[1] });
  }
  return { specifier, names };
}

function importsTest(names) {
  return names.some((binding) => binding.imported === 'test' || binding.local === 'test');
}

it('capture files take test from the per-scenario fixture', () => {
  const files = captureFiles(guiDir);
  assert.ok(files.length > 0, 'expected capture files under apps/web/e2e/gui');
  const problems = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(repoRoot.length + 1);
    if (/\bstartCheckoutServer\s*\(/.test(text)) problems.push(`${rel} calls startCheckoutServer`);
    let takesFixture = false;
    for (const statement of importStatements(text)) {
      const { specifier, names } = valueImports(statement);
      if (!importsTest(names)) continue;
      if (specifier === '@playwright/test') problems.push(`${rel} imports test from @playwright/test`);
      if (specifier === './capture-test.ts') takesFixture = true;
    }
    if (!takesFixture) problems.push(`${rel} does not import test from ./capture-test.ts`);
  }
  assert.deepEqual(problems, []);
});
