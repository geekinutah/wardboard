import { describe, expect, it } from 'vitest';
import { createWard, memberId, tagId, type Member, type WardInput } from '../../src/index.ts';
import { codes, errorsOf, member, T1, valueOf, withCode } from './helpers.ts';

const ALLOWED_MEMBER_KEYS = [
  'category',
  'externalCallings',
  'id',
  'name',
  'needsApproval',
  'note',
  'photoRef',
  'removedDate',
  'tagIds',
];

function wardInput(...members: Member[]): WardInput {
  return {
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    tags: { [T1]: { id: T1, name: 'Musical' } },
  };
}

describe('createWard', () => {
  it('createWard accepts a valid ward', () => {
    const input = wardInput(
      member('m-1', {
        name: 'Ada Fictional',
        category: 'adult',
        photoRef: 'photos/m-1.jpg',
        note: 'Prefers evening meetings.',
        tagIds: [T1],
        needsApproval: true,
        removedDate: '2026-03-01',
        externalCallings: [{ unit: 'Example Stake', title: 'Stake Clerk' }],
      }),
      member('m-2', { category: 'youth' }),
    );

    const ward = valueOf(createWard(input));

    expect(ward).toEqual(input);
  });

  it('createWard normalizes names by trimming whitespace', () => {
    const input: WardInput = {
      members: { [memberId('m-1')]: member('m-1', { name: '  Ada Fictional  ' }) },
      tags: { [T1]: { id: T1, name: ' Musical ' } },
    };

    const ward = valueOf(createWard(input));

    expect(ward.members[memberId('m-1')]?.name).toBe('Ada Fictional');
    expect(ward.tags[T1]?.name).toBe('Musical');
  });

  it('createWard accepts an empty ward', () => {
    const ward = valueOf(createWard({ members: {}, tags: {} }));

    expect(ward).toEqual({ members: {}, tags: {} });
  });

  it('createWard rejects duplicate tag names case-insensitively', () => {
    const youth = tagId('t-youth');
    const youthLower = tagId('t-youth-2');
    const errors = errorsOf(
      createWard({
        members: {},
        tags: { [youth]: { id: youth, name: 'Youth' }, [youthLower]: { id: youthLower, name: ' youth' } },
      }),
    );

    expect(codes(errors)).toEqual(['duplicate_tag_name']);
    expect(errors[0]?.path).toBe('tags.t-youth-2.name');
  });

  it('createWard validates member fields', () => {
    const errors = errorsOf(
      createWard(
        wardInput(
          member('m-1', { name: '   ' }),
          member('m-2', { note: 'x'.repeat(281) }),
          member('m-3', { removedDate: '2026-02-30' }),
          member('m-4', { tagIds: [T1, T1] }),
        ),
      ),
    );

    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-1.name' }),
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-2.note' }),
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-3.removedDate' }),
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-4.tagIds[1]' }),
    ]);
  });

  it('createWard accepts note boundary 280', () => {
    const note = 'x'.repeat(280);

    const ward = valueOf(createWard(wardInput(member('m-1', { note }))));

    expect(ward.members[memberId('m-1')]?.note).toBe(note);
  });

  it('createWard counts note length in characters, not UTF-16 code units', () => {
    // 280 emoji are 560 UTF-16 code units but 280 characters (SQLite length()).
    const note = '\u{1F600}'.repeat(280);

    expect(createWard(wardInput(member('m-1', { note }))).ok).toBe(true);
    expect(codes(errorsOf(createWard(wardInput(member('m-1', { note: `${note}x` })))))).toEqual(['invalid_field']);
  });

  it('createWard checks removedDate against the real calendar, including leap years', () => {
    expect(createWard(wardInput(member('m-1', { removedDate: '2028-02-29' }))).ok).toBe(true);
    expect(createWard(wardInput(member('m-1', { removedDate: '2000-02-29' }))).ok).toBe(true);
    expect(createWard(wardInput(member('m-1', { removedDate: '2026-12-31' }))).ok).toBe(true);

    for (const bad of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-05', '2026-01-05T00:00:00Z', '']) {
      const errors = errorsOf(createWard(wardInput(member('m-1', { removedDate: bad }))));
      expect(errors, bad).toEqual([expect.objectContaining({ code: 'invalid_field', path: 'members.m-1.removedDate' })]);
    }
  });

  it('createWard rejects bad enum values and mismatched ids at runtime', () => {
    const errors = errorsOf(
      createWard({
        members: {
          [memberId('m-1')]: member('m-1', { category: 'child' as unknown as Member['category'] }),
          [memberId('m-x')]: member('m-2'),
        },
        tags: {},
      }),
    );

    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-1.category' }),
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-x.id' }),
    ]);
  });

  it('createWard reports member tags that are not in the ward', () => {
    const errors = errorsOf(createWard(wardInput(member('m-1', { tagIds: [tagId('t-missing')] }))));

    expect(errors).toEqual([expect.objectContaining({ code: 'dangling_reference', path: 'members.m-1.tagIds[0]' })]);
  });

  it('createWard rejects empty external calling fields', () => {
    const errors = errorsOf(
      createWard(wardInput(member('m-1', { externalCallings: [{ unit: 'Example Stake', title: ' ' }] }))),
    );

    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid_field', path: 'members.m-1.externalCallings[0].title' }),
    ]);
  });

  it('member has no disallowed fields', () => {
    const smuggled = { ...member('m-1'), birthDate: '2001-01-01', email: 'ada@example.test' } as Member;

    const ward = valueOf(createWard(wardInput(smuggled)));
    const constructed = ward.members[memberId('m-1')];

    expect(Object.keys(constructed ?? {}).sort()).toEqual(ALLOWED_MEMBER_KEYS);
  });

  it('constructed wards are deeply frozen', () => {
    const ward = valueOf(createWard(wardInput(member('m-1', { tagIds: [T1] }))));
    const m1 = ward.members[memberId('m-1')];

    expect(() => {
      (m1?.tagIds as unknown as string[]).push('t-2');
    }).toThrow(TypeError);
    expect(() => {
      (ward.members as Record<string, Member>)['m-9'] = member('m-9');
    }).toThrow(TypeError);
  });

  it('createWard does not keep references to its input', () => {
    const input = wardInput(member('m-1', { tagIds: [T1] }));
    const ward = valueOf(createWard(input));

    (input.members[memberId('m-1')]?.tagIds as unknown as string[]).push('t-other');

    expect(ward.members[memberId('m-1')]?.tagIds).toEqual([T1]);
  });

  it('createWard reports all of a ward\'s errors together', () => {
    const errors = errorsOf(
      createWard({
        members: { [memberId('m-1')]: member('m-1', { name: '', note: 'x'.repeat(300) }) },
        tags: { [T1]: { id: T1, name: 'A' }, [tagId('t-2')]: { id: tagId('t-2'), name: 'a' } },
      }),
    );

    expect(codes(errors).sort()).toEqual(['duplicate_tag_name', 'invalid_field', 'invalid_field']);
    expect(withCode(errors, 'invalid_field').map((e) => e.path)).toEqual(['members.m-1.name', 'members.m-1.note']);
  });
});
