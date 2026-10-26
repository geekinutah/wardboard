import { describe, expect, it } from 'vitest';
import { memberId, sequentialIds } from '../../src/index.ts';

describe('ids', () => {
  it('sequentialIds is deterministic and independent per generator', () => {
    const first = sequentialIds('p');
    const second = sequentialIds('p');

    expect([first(), first(), first()]).toEqual(['p-0001', 'p-0002', 'p-0003']);
    expect([second(), second()]).toEqual(['p-0001', 'p-0002']);
    expect(first()).toBe('p-0004');
  });

  it('sequentialIds keeps counting past four digits', () => {
    const next = sequentialIds('m');
    let last = '';
    for (let i = 0; i < 10000; i += 1) {
      last = next();
    }

    expect(last).toBe('m-10000');
  });

  it('id helpers are plain strings at runtime', () => {
    expect(memberId('m-1')).toBe('m-1');
  });
});
