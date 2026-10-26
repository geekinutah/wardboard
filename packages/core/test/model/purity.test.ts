import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const FORBIDDEN = ["from 'node:", 'from "node:', 'Date.now(', 'new Date(', 'Math.random(', 'randomUUID(', 'fetch('];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('purity', () => {
  it('core source is pure', () => {
    const files = sourceFiles(SRC);
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((pattern) => text.includes(pattern)).map((pattern) => `${relative(SRC, file)}: ${pattern}`);
    });

    expect(files.length).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });
});
