import { describe, expect, it } from 'vitest';
import { createTag, memberId, sequentialIds, setMemberTags, type Ward } from '@wardboard/core';
import { tagsScenario } from './fixtures.ts';
import { deleteConfirmation, dugoutMatches, memberCountByTag, tagSuggestions } from './tag-model.ts';

describe('memberCountByTag', () => {
  it('memberCountByTag counts members per tag, 0 for unused', () => {
    const s = tagsScenario();
    const counts = memberCountByTag(s.ward);
    expect(counts[s.tags.weekday]).toBe(2);
    expect(counts[s.tags.pianist]).toBe(1);
    expect(counts[s.tags.evenings]).toBe(1);
    expect(counts[s.tags.outdoors]).toBe(0);
    expect(Object.keys(counts)).toHaveLength(4);
  });

  it('counts a member once even when the tag list repeats it', () => {
    const s = tagsScenario();
    const counts = memberCountByTag(s.ward);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('tagSuggestions', () => {
  it('tagSuggestions filters case-insensitively, excludes carried, sorts, caps at 8', () => {
    const s = tagsScenario();
    const filtered = tagSuggestions(s.ward, [s.tags.weekday], 'E');
    // Weekday is carried; Pianist and Outdoors contain no "e".
    expect(filtered.suggestions.map((x) => x.name)).toEqual(['Evenings only']);
    expect(filtered.suggestions[0]?.members).toBe(1);

    const all = tagSuggestions(s.ward, [], '');
    expect(all.suggestions.map((x) => x.name)).toEqual(['Evenings only', 'Outdoors', 'Pianist', 'Weekday']);

    const lower = tagSuggestions(s.ward, [], 'WEEK');
    expect(lower.suggestions.map((x) => x.name)).toEqual(['Weekday']);

    let ward: Ward = s.ward;
    const ids = sequentialIds('x');
    for (let i = 0; i < 10; i += 1) {
      const r = createTag(ward, ids, `Extra ${String.fromCharCode(97 + i)}`);
      if (!r.ok) throw new Error(r.error.message);
      ward = r.value.ward;
    }
    const capped = tagSuggestions(ward, [], 'extra');
    expect(capped.suggestions).toHaveLength(8);
    expect(capped.suggestions[0]?.name).toBe('Extra a');
  });

  it('tagSuggestions offers create only for a new non-blank name', () => {
    const s = tagsScenario();
    expect(tagSuggestions(s.ward, [], 'weekday').create).toBeNull();
    expect(tagSuggestions(s.ward, [], '   ').create).toBeNull();
    expect(tagSuggestions(s.ward, [], '').create).toBeNull();
    expect(tagSuggestions(s.ward, [], '  Brand new ').create).toBe('Brand new');
    // A partial match is not a duplicate.
    expect(tagSuggestions(s.ward, [], 'week').create).toBe('week');
  });

  it('a query that exactly matches a carried tag yields no suggestion and no create', () => {
    const s = tagsScenario();
    const result = tagSuggestions(s.ward, [s.tags.weekday], 'weekday');
    expect(result.suggestions).toEqual([]);
    expect(result.create).toBeNull();
  });

  it('an empty ward only offers create once something is typed', () => {
    const s = tagsScenario();
    const empty: Ward = { members: s.ward.members, tags: {} };
    expect(tagSuggestions(empty, [], '')).toEqual({ suggestions: [], create: null });
    expect(tagSuggestions(empty, [], 'x')).toEqual({ suggestions: [], create: 'x' });
  });
});

describe('dugoutMatches', () => {
  it('dugoutMatches keeps input order and only members with a preferred tag', () => {
    const s = tagsScenario();
    const board = s.proposal.board;
    const result = dugoutMatches(board, s.ward, s.listAssignment, [s.members.dee, s.members.cid, s.members.ann]);
    expect(result).toEqual([s.members.cid, s.members.ann]);
  });

  it('returns nothing when no dugout member matches, or for unknown ids', () => {
    const s = tagsScenario();
    expect(dugoutMatches(s.proposal.board, s.ward, s.listAssignment, [s.members.dee])).toEqual([]);
    expect(dugoutMatches(s.proposal.board, s.ward, s.listAssignment, [memberId('nobody')])).toEqual([]);
    expect(dugoutMatches(s.proposal.board, s.ward, s.listAssignment, [])).toEqual([]);
  });

  it('is unaffected by member tags not on the preference list', () => {
    const s = tagsScenario();
    const r = setMemberTags(s.ward, s.members.dee, [s.tags.outdoors]);
    if (!r.ok) throw new Error(r.error.message);
    expect(dugoutMatches(s.proposal.board, r.value, s.listAssignment, [s.members.dee])).toEqual([]);
  });
});

describe('deleteConfirmation', () => {
  it('deleteConfirmation singular/plural and optional calling-tags clause', () => {
    expect(deleteConfirmation('Weekday', { members: 1, callingPreferences: 1, callingTags: 0 })).toEqual({
      title: 'Delete “Weekday”?',
      body: 'Removes it from 1 person and from the preferences on 1 calling. Nothing else changes.',
    });
    expect(deleteConfirmation('Weekday', { members: 9, callingPreferences: 3, callingTags: 0 }).body).toBe(
      'Removes it from 9 people and from the preferences on 3 callings. Nothing else changes.',
    );
    expect(deleteConfirmation('X', { members: 0, callingPreferences: 0, callingTags: 0 }).body).toBe(
      'Removes it from 0 people and from the preferences on 0 callings. Nothing else changes.',
    );
    expect(deleteConfirmation('X', { members: 2, callingPreferences: 1, callingTags: 1 }).body).toBe(
      'Removes it from 2 people and from the preferences on 1 calling and the tags on 1 calling. Nothing else changes.',
    );
    expect(deleteConfirmation('X', { members: 2, callingPreferences: 1, callingTags: 4 }).body).toBe(
      'Removes it from 2 people and from the preferences on 1 calling and the tags on 4 callings. Nothing else changes.',
    );
  });
});
