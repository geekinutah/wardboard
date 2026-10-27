import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_MEMBER_NAMES } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { seedFixture } from '../../dev/index.ts';
import { cleanupStores, openTempStore } from './helpers.ts';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const DEV_DIR = fileURLToPath(new URL('../../dev/', import.meta.url));

afterEach(cleanupStores);

function typescriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...typescriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value !== undefined) found.push(value);
    }
  }
  return found;
}

function pointsAtDev(specifier: string, fromFile: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const devRoot = path.resolve(DEV_DIR);
  return resolved === devRoot || resolved.startsWith(`${devRoot}${path.sep}`);
}

describe('fixture seed', () => {
  it('seedFixture writes the fixture ward, current and one draft proposal', () => {
    const { store } = openTempStore();

    seedFixture(store);

    const ward = store.loadWard();
    expect(Object.keys(ward.members)).toHaveLength(FIXTURE_MEMBER_NAMES.length);
    expect(Object.values(ward.members).map((member) => member.name).sort()).toEqual(
      [...FIXTURE_MEMBER_NAMES].sort(),
    );
    expect(store.loadCurrent()?.importVersion).toBe('fixture');
    const proposals = store.listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ name: 'Spring adjustments', status: 'draft', tabOrder: 0 });
    const proposal = proposals[0];
    if (proposal === undefined) expect.fail('missing proposal');
    expect(store.loadProposal(proposal.id)?.status).toBe('draft');
    expect(store.loadProposal(proposal.id)?.name).toBe('Spring adjustments');
  });

  it('src never imports fixtures or dev', () => {
    const offenders: string[] = [];
    for (const file of typescriptFiles(SRC_DIR)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of specifiers(source)) {
        if (specifier.includes('core/fixtures') || pointsAtDev(specifier, file)) {
          offenders.push(`${path.relative(SRC_DIR, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
