import { describe, expect, it } from 'vitest';
import {
  parseMemberName,
  parseMemberNote,
  parseMemberPatch,
  parseTagIds,
  parseTagName,
} from '../../src/members/index.ts';

const NAME_100 = 'a'.repeat(100);
const NOTE_280 = 'n'.repeat(280);
const TAG_40 = 't'.repeat(40);
const EMOJI_280 = '😀'.repeat(280);

describe('member profile input rules', () => {
  it('name trimmed 1–100; note trimmed, blank → null, ≤280; tag name 1–40', () => {
    expect(parseMemberName('Ada')).toEqual({ ok: true, value: 'Ada' });
    expect(parseMemberName('  Ada Fictional  ')).toEqual({ ok: true, value: 'Ada Fictional' });
    expect(parseMemberName('A')).toEqual({ ok: true, value: 'A' });
    expect(parseMemberName(NAME_100)).toEqual({ ok: true, value: NAME_100 });
    expect(parseMemberName(`  ${NAME_100}  `)).toEqual({ ok: true, value: NAME_100 });

    expect(parseMemberName('').ok).toBe(false);
    expect(parseMemberName('   ').ok).toBe(false);
    expect(parseMemberName('\n\t  ').ok).toBe(false);
    expect(parseMemberName('a'.repeat(101)).ok).toBe(false);
    expect(parseMemberName(`  ${'a'.repeat(101)}  `).ok).toBe(false);
    expect(parseMemberName(1).ok).toBe(false);
    expect(parseMemberName(null).ok).toBe(false);

    expect(parseMemberNote(null)).toEqual({ ok: true, value: null });
    expect(parseMemberNote('')).toEqual({ ok: true, value: null });
    expect(parseMemberNote('   ')).toEqual({ ok: true, value: null });
    expect(parseMemberNote('\n\t')).toEqual({ ok: true, value: null });
    expect(parseMemberNote('  Brings the rolls.  ')).toEqual({ ok: true, value: 'Brings the rolls.' });
    expect(parseMemberNote(NOTE_280)).toEqual({ ok: true, value: NOTE_280 });
    expect(parseMemberNote(`  ${NOTE_280}  `)).toEqual({ ok: true, value: NOTE_280 });
    expect(parseMemberNote(EMOJI_280)).toEqual({ ok: true, value: EMOJI_280 });

    expect(parseMemberNote('n'.repeat(281)).ok).toBe(false);
    expect(parseMemberNote(`  ${'n'.repeat(281)}`).ok).toBe(false);
    expect(parseMemberNote('😀'.repeat(281)).ok).toBe(false);
    expect(parseMemberNote(12).ok).toBe(false);
    expect(parseMemberNote(undefined).ok).toBe(false);

    expect(parseTagName('Musical')).toEqual({ ok: true, value: 'Musical' });
    expect(parseTagName('  Musical  ')).toEqual({ ok: true, value: 'Musical' });
    expect(parseTagName('T')).toEqual({ ok: true, value: 'T' });
    expect(parseTagName(TAG_40)).toEqual({ ok: true, value: TAG_40 });
    expect(parseTagName(`  ${TAG_40}  `)).toEqual({ ok: true, value: TAG_40 });

    expect(parseTagName('').ok).toBe(false);
    expect(parseTagName('   ').ok).toBe(false);
    expect(parseTagName('t'.repeat(41)).ok).toBe(false);
    expect(parseTagName(` ${'t'.repeat(41)} `).ok).toBe(false);
    expect(parseTagName(null).ok).toBe(false);
  });

  it('patch rejects empty, unknown keys, duplicate or >20 tagIds, non-strings', () => {
    expect(parseMemberPatch({ name: '  Ada  ' })).toEqual({ ok: true, value: { name: 'Ada' } });
    expect(parseMemberPatch({ note: '   ' })).toEqual({ ok: true, value: { note: null } });
    expect(parseMemberPatch({ note: null })).toEqual({ ok: true, value: { note: null } });
    expect(parseMemberPatch({ tagIds: [] })).toEqual({ ok: true, value: { tagIds: [] } });
    expect(parseMemberPatch({ name: 'Ada', note: 'Hello', tagIds: ['t-0001', 't-0002'] })).toEqual({
      ok: true,
      value: { name: 'Ada', note: 'Hello', tagIds: ['t-0001', 't-0002'] },
    });
    expect(parseMemberPatch({ tagIds: Array.from({ length: 20 }, (_item, index) => `t-${String(index)}`) })).toEqual({
      ok: true,
      value: { tagIds: Array.from({ length: 20 }, (_item, index) => `t-${String(index)}`) },
    });
    expect(parseMemberPatch({ name: NAME_100 })).toEqual({ ok: true, value: { name: NAME_100 } });
    expect(parseMemberPatch({ note: NOTE_280 })).toEqual({ ok: true, value: { note: NOTE_280 } });

    expect(parseMemberPatch({}).ok).toBe(false);
    expect(parseMemberPatch([]).ok).toBe(false);
    expect(parseMemberPatch(null).ok).toBe(false);
    expect(parseMemberPatch('Ada').ok).toBe(false);
    expect(parseMemberPatch({ name: 'Ada', photoRef: null }).ok).toBe(false);
    expect(parseMemberPatch({ extra: true }).ok).toBe(false);
    expect(parseMemberPatch({ name: 'Ada', note: 'Hello', tagIds: ['t-1'], needsApproval: true }).ok).toBe(false);
    expect(parseMemberPatch({ name: 1 }).ok).toBe(false);
    expect(parseMemberPatch({ name: '   ' }).ok).toBe(false);
    expect(parseMemberPatch({ name: 'a'.repeat(101) }).ok).toBe(false);
    expect(parseMemberPatch({ note: 1 }).ok).toBe(false);
    expect(parseMemberPatch({ note: 'n'.repeat(281) }).ok).toBe(false);
    expect(parseMemberPatch({ tagIds: 't-0001' }).ok).toBe(false);
    expect(parseMemberPatch({ tagIds: ['t-0001', 't-0001'] }).ok).toBe(false);
    expect(parseMemberPatch({ tagIds: ['t-0001', ''] }).ok).toBe(false);
    expect(parseMemberPatch({ tagIds: ['t-0001', 2] }).ok).toBe(false);
    expect(parseMemberPatch({ tagIds: [null] }).ok).toBe(false);
    expect(parseTagIds(['ok', 'also']).ok).toBe(true);
    expect(parseTagIds([]).ok).toBe(true);
    expect(parseTagIds(['a', 'a']).ok).toBe(false);
    expect(parseTagIds(Array.from({ length: 21 }, (_item, index) => `t-${String(index)}`)).ok).toBe(false);
    expect(parseTagIds(['a', 1]).ok).toBe(false);
    expect(parseTagIds('a').ok).toBe(false);
  });
});
