import { describe, expect, it } from 'vitest';
import { normalizeSearchText } from '../../src/search/normalize.ts';

describe('normalizeSearchText', () => {
  it('normalizes case, accents and whitespace', () => {
    expect(normalizeSearchText('  JOSÉ   de ')).toBe('jose de');
    expect(normalizeSearchText('  JOSE\u0301   de ')).toBe('jose de');
  });
});
