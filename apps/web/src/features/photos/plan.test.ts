import { describe, expect, it } from 'vitest';
import { planPhotoBatch, type PhotoMember } from './plan.ts';

const members: readonly PhotoMember[] = [
  { id: 'zed', name: 'Zed', photoRef: null },
  { id: 'amy', name: 'Amy', photoRef: 'existing-amy' },
  { id: 'bob', name: 'Bob', photoRef: null },
  { id: 'moe', name: 'Moe', photoRef: 'existing-moe' },
];

describe('planPhotoBatch', () => {
  it('plan splits new photos from replacements and preserves order', () => {
    const incoming = [
      { memberId: 'moe' },
      { memberId: 'zed' },
      { memberId: 'amy' },
      { memberId: 'bob' },
    ];
    const membersBefore = members.map((member) => ({ ...member }));
    const incomingBefore = incoming.map((item) => ({ ...item }));

    expect(planPhotoBatch(members, incoming)).toEqual({
      ok: true,
      apply: ['zed', 'bob'],
      compare: ['moe', 'amy'],
    });
    expect(members).toEqual(membersBefore);
    expect(incoming).toEqual(incomingBefore);
  });

  it('plan rejects duplicates and unknown ids', () => {
    const duplicate = planPhotoBatch(members, [{ memberId: 'zed' }, { memberId: 'zed' }]);
    expect(duplicate).toEqual({ ok: false, code: 'duplicate_member' });
    expect(Object.hasOwn(duplicate, 'apply')).toBe(false);
    expect(Object.hasOwn(duplicate, 'compare')).toBe(false);

    const unknown = planPhotoBatch(members, [{ memberId: 'zed' }, { memberId: 'missing' }]);
    expect(unknown).toEqual({ ok: false, code: 'unknown_member' });
    expect(Object.hasOwn(unknown, 'apply')).toBe(false);
    expect(Object.hasOwn(unknown, 'compare')).toBe(false);
  });

  it('plan of no incoming photos is empty', () => {
    expect(planPhotoBatch(members, [])).toEqual({ ok: true, apply: [], compare: [] });
    expect(planPhotoBatch([], [])).toEqual({ ok: true, apply: [], compare: [] });
  });
});
