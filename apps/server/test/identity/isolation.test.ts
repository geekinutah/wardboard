import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function findTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('identity header isolation', () => {
  it('only src/identity reads tailscale identity headers', async () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const identityDir = path.resolve(srcDir, 'identity');
    const tsFiles = await findTsFiles(srcDir);

    const violatingFiles: string[] = [];
    let insideCount = 0;

    for (const filePath of tsFiles) {
      const content = await readFile(filePath, 'utf8');
      const hasTailscaleUser = /tailscale-user/i.test(content);
      const isInsideIdentity = filePath.startsWith(identityDir + path.sep);

      if (hasTailscaleUser) {
        if (isInsideIdentity) {
          insideCount++;
        } else {
          violatingFiles.push(path.relative(srcDir, filePath));
        }
      }
    }

    expect(violatingFiles, 'Files outside src/identity/ containing tailscale-user').toEqual([]);
    expect(insideCount, 'At least one file in src/identity/ must contain tailscale-user').toBeGreaterThan(0);
  });
});
