import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collect, loadConfig } from '@wardboard/collector';

describe('@wardboard/collector exports', () => {
  it('the package export exposes collect and loadConfig', async () => {
    expect(typeof collect).toBe('function');
    expect(typeof loadConfig).toBe('function');
    const config = await loadConfig(path.resolve(import.meta.dirname, '../config/directory.json'));
    expect(config.layoutVersion).toBe('directory-v2');
  });
});
