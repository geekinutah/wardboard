import { describe, expect, it } from 'vitest';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  assignmentId,
  boardId,
  createBoard,
  createTag,
  createWard,
  deleteTag,
  preferenceMatches,
  proposalId,
  renameTag,
  sequentialIds,
  setCallingPreferences,
  setCallingTags,
  setMemberTags,
  tagId,
  tagUsage,
  type Board,
  type BoardTagResult,
  type TagError,
  type TagId,
  type TagResult,
  type Ward,
} from '../../src/index.ts';
import { A1, assignment, member, minimalBoard } from '../model/helpers.ts';
import { assignmentNamed, isDeeplyFrozen, memberNamed } from '../ops/helpers.ts';

function expectValue<T>(result: TagResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectWard(result: TagResult<Ward>): Ward {
  return expectValue(result);
}

function expectBoard(result: BoardTagResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function expectError(result: { ok: true } | { ok: false; error: TagError }): TagError {
  if (result.ok) {
    throw new Error('expected the operation to fail, but it succeeded');
  }
  expect(result.error.message).not.toBe('');
  return result.error;
}

function tagByName(ward: Ward, name: string): TagId {
  const found = Object.values(ward.tags).find((tag) => tag.name === name);
  if (found === undefined) {
    throw new Error(`no tag named ${name}`);
  }
  return found.id;
}

function mustWard(input: Ward): Ward {
  const result = createWard(input);
  if (!result.ok) {
    throw new Error(`test ward invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function mustBoard(input: Parameters<typeof createBoard>[0], ward: Ward): Board {
  const result = createBoard(input, ward);
  if (!result.ok) {
    throw new Error(`test board invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

/** Ward with only the tags named here. Used for name and duplicate cases. */
function wardWithTags(tags: readonly { readonly id: string; readonly name: string }[]): Ward {
  return mustWard({
    members: {},
    tags: Object.fromEntries(
      tags.map((tag) => {
        const id = tagId(tag.id);
        return [id, { id, name: tag.name }];
      }),
    ),
  });
}

function wardWithout(ward: Ward, id: TagId): Ward {
  const tags: Record<string, Ward['tags'][TagId]> = {};
  for (const [key, tag] of Object.entries(ward.tags)) {
    if (key !== id) {
      tags[key] = tag;
    }
  }
  const members: Record<string, Ward['members'][keyof Ward['members']]> = {};
  for (const [key, person] of Object.entries(ward.members)) {
    members[key] = person.tagIds.includes(id) ? { ...person, tagIds: person.tagIds.filter((tag) => tag !== id) } : person;
  }
  return { tags, members };
}

function boardWithout(board: Board, id: TagId): Board {
  return {
    ...board,
    assignments: Object.fromEntries(
      Object.entries(board.assignments).map(([key, calling]) => [
        key,
        {
          ...calling,
          callingTagIds: calling.callingTagIds.filter((tag) => tag !== id),
          preferredMemberTagIds: calling.preferredMemberTagIds.filter((tag) => tag !== id),
        },
      ]),
    ),
  };
}

describe('tags', () => {
  it('createTag adds a trimmed tag with a generated id', () => {
    const ward = wardWithTags([{ id: 't-youth', name: 'Youth' }]);
    const ids = sequentialIds('tg');

    const created = expectValue(createTag(ward, ids, '  Weekday availability '));

    expect(created.tagId).toBe(tagId('tg-0001'));
    expect(created.ward.tags[created.tagId]).toEqual({ id: tagId('tg-0001'), name: 'Weekday availability' });
    expect(created.ward.tags[tagId('t-youth')]).toEqual({ id: tagId('t-youth'), name: 'Youth' });

    const second = expectValue(createTag(created.ward, ids, 'Spanish speaker'));
    expect(second.tagId).toBe(tagId('tg-0002'));
    expect(second.ward.tags[second.tagId]?.name).toBe('Spanish speaker');
  });

  it('createTag rejects empty and case-insensitive duplicates', () => {
    const ward = wardWithTags([{ id: 't-youth', name: 'Youth' }]);
    const before = structuredClone(ward);
    const ids = sequentialIds('tg');

    expect(expectError(createTag(ward, ids, '')).code).toBe('invalid_name');
    expect(expectError(createTag(ward, ids, '   ')).code).toBe('invalid_name');
    expect(expectError(createTag(ward, ids, 'youth')).code).toBe('duplicate_tag_name');
    expect(expectError(createTag(ward, ids, 'YOUTH')).code).toBe('duplicate_tag_name');
    expect(expectError(createTag(ward, ids, '  youth  ')).code).toBe('duplicate_tag_name');
    expect(ward).toEqual(before);
    expect(Object.keys(ward.tags)).toEqual(['t-youth']);
  });

  it('renameTag allows a case-only change of its own name', () => {
    const youth = tagId('t-youth');
    const adult = tagId('t-adult');
    const ward = wardWithTags([
      { id: 't-youth', name: 'Youth' },
      { id: 't-adult', name: 'Adult' },
    ]);

    const renamed = expectWard(renameTag(ward, youth, 'YOUTH'));
    expect(renamed.tags[youth]).toEqual({ id: youth, name: 'YOUTH' });
    expect(renamed.tags[adult]).toEqual({ id: adult, name: 'Adult' });

    expect(expectError(renameTag(renamed, youth, 'adult')).code).toBe('duplicate_tag_name');
    expect(expectError(renameTag(renamed, youth, '  ADULT  ')).code).toBe('duplicate_tag_name');
    expect(expectError(renameTag(ward, youth, '   ')).code).toBe('invalid_name');
    expect(expectError(renameTag(ward, tagId('t-missing'), 'Other')).code).toBe('not_found');
    expect(ward.tags[youth]?.name).toBe('Youth');
  });

  it('setMemberTags replaces tags and keeps needsApproval', () => {
    const { ward } = buildFixtureWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const teaches = tagByName(ward, 'Teaches well');
    const musical = tagByName(ward, 'Musical');
    const spanish = tagByName(ward, 'Spanish speaker');
    expect(ward.members[cy]?.needsApproval).toBe(true);
    expect(ward.members[ivy]?.tagIds).toEqual([musical, teaches]);

    const flagged = expectWard(setMemberTags(ward, cy, [teaches, musical, teaches, spanish, musical]));
    expect(flagged.members[cy]?.tagIds).toEqual([teaches, musical, spanish]);
    expect(flagged.members[cy]?.needsApproval).toBe(true);
    expect(flagged.members[cy]?.name).toBe('Cy Mockup');
    expect(flagged.members[ivy]?.tagIds).toEqual([musical, teaches]);

    const replaced = expectWard(setMemberTags(ward, ivy, [spanish, spanish]));
    expect(replaced.members[ivy]?.tagIds).toEqual([spanish]);
    expect(replaced.members[ivy]?.needsApproval).toBe(false);

    const cleared = expectWard(setMemberTags(replaced, ivy, []));
    expect(cleared.members[ivy]?.tagIds).toEqual([]);
    expect(cleared.members[ivy]?.needsApproval).toBe(false);
  });

  it('setMemberTags rejects unknown tags', () => {
    const { ward } = buildFixtureWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    const teaches = tagByName(ward, 'Teaches well');
    const before = structuredClone(ward);

    expect(expectError(setMemberTags(ward, cy, [tagId('t-missing')])).code).toBe('not_found');
    expect(expectError(setMemberTags(ward, cy, [teaches, tagId('t-missing'), teaches])).code).toBe('not_found');
    expect(ward).toEqual(before);
    expect(ward.members[cy]?.needsApproval).toBe(true);
    expect(ward.members[cy]?.tagIds).toEqual([]);
  });

  it('tagUsage counts members and calling references across boards', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const teaches = tagByName(ward, 'Teaches well');
    const before = structuredClone(ward);

    const one = tagUsage(ward, [current], teaches);
    const two = tagUsage(ward, [current, proposal.board], teaches);

    expect(one).toEqual({ members: 5, callingPreferences: 3, callingTags: 1 });
    expect(two).toEqual({ members: 5, callingPreferences: 6, callingTags: 2 });
    expect(two.callingPreferences).toBe(one.callingPreferences * 2);
    expect(two.callingTags).toBe(one.callingTags * 2);
    expect(ward).toEqual(before);
  });

  it('deleteTag removes the tag everywhere', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const teaches = tagByName(ward, 'Teaches well');
    const boards = [proposal.baseline, current, proposal.board];

    const removed = expectValue(deleteTag(ward, boards, teaches));

    expect(removed.ward.tags[teaches]).toBeUndefined();
    for (const person of Object.values(removed.ward.members)) {
      expect(person.tagIds).not.toContain(teaches);
    }
    expect(removed.boards.map((board) => board.id)).toEqual(boards.map((board) => board.id));
    expect(removed.boards.map((board) => board.kind)).toEqual(['baseline', 'current', 'proposal']);
    for (const board of removed.boards) {
      expect(Object.keys(board.assignments).length).toBeGreaterThan(0);
      for (const calling of Object.values(board.assignments)) {
        expect(calling.callingTagIds).not.toContain(teaches);
        expect(calling.preferredMemberTagIds).not.toContain(teaches);
      }
    }
  });

  it('deleteTag leaves everything else unchanged', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const teaches = tagByName(ward, 'Teaches well');
    const cy = memberNamed(ward, 'Cy Mockup');
    const boards = [current, proposal.board, proposal.baseline];
    expect(ward.members[cy]?.needsApproval).toBe(true);

    const removed = expectValue(deleteTag(ward, boards, teaches));

    expect(removed.ward).toEqual(wardWithout(ward, teaches));
    expect(removed.boards).toEqual(boards.map((board) => boardWithout(board, teaches)));
    expect(removed.ward.members[cy]?.needsApproval).toBe(true);
    expect(Object.values(removed.ward.tags).map((tag) => tag.name).sort()).toEqual([
      'Musical',
      'New move-in',
      'Spanish speaker',
      'Weekday availability',
    ]);
    for (const [index, board] of boards.entries()) {
      const next = removed.boards[index];
      if (next === undefined) {
        throw new Error(`missing board at ${String(index)}`);
      }
      expect(next.version).toBe(board.version);
      expect(next.id).toBe(board.id);
      expect(next.kind).toBe(board.kind);
      expect(next.placements).toEqual(board.placements);
    }
  });

  it('deleteTag of an unknown tag is refused', () => {
    const { ward, current } = buildFixtureWard();
    const beforeWard = structuredClone(ward);
    const beforeBoard = structuredClone(current);

    expect(expectError(deleteTag(ward, [current], tagId('t-missing'))).code).toBe('not_found');
    expect(ward).toEqual(beforeWard);
    expect(current).toEqual(beforeBoard);
  });

  it('calling tag edits are proposal-only', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const teaches = tagByName(ward, 'Teaches well');
    const musical = tagByName(ward, 'Musical');
    const currentOrganist = assignmentNamed(current, 'Music', 'Organist');
    const baselineOrganist = assignmentNamed(proposal.baseline, 'Music', 'Organist');
    const organist = assignmentNamed(proposal.board, 'Music', 'Organist');
    expect(currentOrganist.callingTagIds).toEqual([musical]);

    expect(expectError(setCallingTags(current, ward, currentOrganist.id, [teaches])).code).toBe('board_not_editable');
    expect(expectError(setCallingPreferences(current, ward, currentOrganist.id, [teaches])).code).toBe('board_not_editable');
    expect(expectError(setCallingTags(proposal.baseline, ward, baselineOrganist.id, [teaches])).code).toBe(
      'board_not_editable',
    );
    expect(current.assignments[currentOrganist.id]?.callingTagIds).toEqual([musical]);
    expect(proposal.baseline.assignments[baselineOrganist.id]?.callingTagIds).toEqual([musical]);

    const edited = expectBoard(setCallingTags(proposal.board, ward, organist.id, [teaches, teaches]));
    expect(edited.kind).toBe('proposal');
    expect(edited.version).toBe(proposal.board.version);
    expect(edited.assignments[organist.id]?.callingTagIds).toEqual([teaches]);
    expect(edited.assignments[organist.id]?.preferredMemberTagIds).toEqual([musical]);
    expect(expectError(setCallingTags(proposal.board, ward, assignmentId('a-missing'), [teaches])).code).toBe('not_found');
    expect(expectError(setCallingTags(proposal.board, ward, organist.id, [tagId('t-missing')])).code).toBe('not_found');
  });

  it('setCallingPreferences replaces and dedupes', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const organist = assignmentNamed(proposal.board, 'Music', 'Organist');
    const teaches = tagByName(ward, 'Teaches well');
    const weekday = tagByName(ward, 'Weekday availability');
    const musical = tagByName(ward, 'Musical');
    expect(organist.preferredMemberTagIds).toEqual([musical]);
    expect(organist.callingTagIds).toEqual([musical]);

    const next = expectBoard(
      setCallingPreferences(proposal.board, ward, organist.id, [teaches, weekday, teaches, weekday]),
    );

    expect(next.assignments[organist.id]?.preferredMemberTagIds).toEqual([teaches, weekday]);
    expect(next.assignments[organist.id]?.callingTagIds).toEqual([musical]);
    expect(next.version).toBe(proposal.board.version);
    expect(next.id).toBe(proposal.board.id);
    expect(next.kind).toBe('proposal');
    expect(expectError(setCallingPreferences(proposal.board, ward, assignmentId('a-missing'), [teaches])).code).toBe(
      'not_found',
    );
    expect(expectError(setCallingPreferences(proposal.board, ward, organist.id, [musical, tagId('t-missing')])).code).toBe(
      'not_found',
    );
  });

  it('calling edits on one proposal do not affect another', () => {
    const { ward, current } = buildFixtureWard();
    const proposalA = buildFixtureProposal(current, ward, { id: proposalId('pr-a'), name: 'Proposal A' });
    const proposalB = buildFixtureProposal(current, ward, { id: proposalId('pr-b'), name: 'Proposal B' });
    const teaches = tagByName(ward, 'Teaches well');
    const organistA = assignmentNamed(proposalA.board, 'Music', 'Organist');
    const organistB = assignmentNamed(proposalB.board, 'Music', 'Organist');
    expect(organistA.id).toBe(organistB.id);
    const beforeA = structuredClone(proposalA.board);
    const beforeB = structuredClone(proposalB.board);

    const edited = expectBoard(setCallingTags(proposalA.board, ward, organistA.id, [teaches]));

    expect(edited.assignments[organistA.id]?.callingTagIds).toEqual([teaches]);
    expect(proposalA.board).toEqual(beforeA);
    expect(proposalB.board).toEqual(beforeB);
    expect(proposalB.board.assignments[organistB.id]?.callingTagIds).toEqual(organistB.callingTagIds);
  });

  it('preferenceMatches returns matching preferred tags in order', () => {
    const { ward, current } = buildFixtureWard();
    const organist = assignmentNamed(current, 'Music', 'Organist');
    const musical = tagByName(ward, 'Musical');
    const gus = memberNamed(ward, 'Gus Demo');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const ada = memberNamed(ward, 'Ada Fictional');
    expect(organist.preferredMemberTagIds).toEqual([musical]);
    expect(ward.members[ivy]?.tagIds).toEqual([musical, tagByName(ward, 'Teaches well')]);

    expect(preferenceMatches(current, ward, organist.id, gus)).toEqual([musical]);
    expect(preferenceMatches(current, ward, organist.id, ivy)).toEqual([musical]);
    expect(preferenceMatches(current, ward, organist.id, ada)).toEqual([]);

    const teaches = tagId('t-teaches');
    const musicalId = tagId('t-musical');
    const weekday = tagId('t-weekday');
    const orderedIvy = member('m-ivy', { tagIds: [musicalId, teaches] });
    const orderedGus = member('m-gus', { tagIds: [musicalId] });
    const orderedWard = mustWard({
      members: {
        [orderedIvy.id]: orderedIvy,
        [orderedGus.id]: orderedGus,
      },
      tags: {
        [musicalId]: { id: musicalId, name: 'Musical' },
        [teaches]: { id: teaches, name: 'Teaches well' },
        [weekday]: { id: weekday, name: 'Weekday availability' },
      },
    });
    const preferred: readonly TagId[] = [teaches, musicalId, weekday];
    const board = mustBoard(
      minimalBoard({
        id: boardId('b-pref'),
        kind: 'proposal',
        version: 4,
        placements: {},
        assignments: { [A1]: assignment('a-1', { preferredMemberTagIds: [...preferred] }) },
      }),
      orderedWard,
    );

    expect(preferenceMatches(board, orderedWard, A1, orderedIvy.id)).toEqual([teaches, musicalId]);
    expect(preferenceMatches(board, orderedWard, A1, orderedGus.id)).toEqual([musicalId]);
  });

  it('results are frozen and inputs untouched', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const wardBefore = structuredClone(ward);
    const currentBefore = structuredClone(current);
    const boardBefore = structuredClone(proposal.board);
    const teaches = tagByName(ward, 'Teaches well');
    const musical = tagByName(ward, 'Musical');
    const cy = memberNamed(ward, 'Cy Mockup');

    const created = expectValue(createTag(ward, sequentialIds('new'), 'New tag'));
    expect(isDeeplyFrozen(created.ward)).toBe(true);
    expect(ward).toEqual(wardBefore);
    expect(() => {
      Object.assign(created.ward.tags, { extra: { id: tagId('t-extra'), name: 'Nope' } });
    }).toThrow(TypeError);

    const tagged = expectWard(setMemberTags(ward, cy, [teaches, musical, teaches]));
    expect(isDeeplyFrozen(tagged)).toBe(true);
    expect(ward).toEqual(wardBefore);
    const taggedIds = tagged.members[cy]?.tagIds;
    if (taggedIds === undefined) {
      throw new Error('missing member tags');
    }
    expect(() => {
      Object.assign(taggedIds, { extra: teaches });
    }).toThrow(TypeError);

    const renamed = expectWard(renameTag(ward, teaches, 'TEACHES WELL'));
    expect(isDeeplyFrozen(renamed)).toBe(true);
    expect(renamed.tags[teaches]?.name).toBe('TEACHES WELL');
    expect(ward).toEqual(wardBefore);

    const removed = expectValue(deleteTag(ward, [current, proposal.board], teaches));
    expect(isDeeplyFrozen(removed.ward)).toBe(true);
    expect(removed.boards.every((board) => isDeeplyFrozen(board))).toBe(true);
    expect(ward).toEqual(wardBefore);
    expect(current).toEqual(currentBefore);
    expect(proposal.board).toEqual(boardBefore);

    const organist = assignmentNamed(proposal.board, 'Music', 'Organist');
    const edited = expectBoard(setCallingTags(proposal.board, ward, organist.id, [teaches]));
    expect(isDeeplyFrozen(edited)).toBe(true);
    expect(edited.version).toBe(proposal.board.version);
    expect(proposal.board).toEqual(boardBefore);
    const callingTags = edited.assignments[organist.id]?.callingTagIds;
    if (callingTags === undefined) {
      throw new Error('missing calling tags');
    }
    expect(() => {
      Object.assign(callingTags, { extra: musical });
    }).toThrow(TypeError);

    const prefs = expectBoard(setCallingPreferences(proposal.board, ward, organist.id, [teaches]));
    expect(isDeeplyFrozen(prefs)).toBe(true);
    expect(prefs.version).toBe(proposal.board.version);
    expect(proposal.board).toEqual(boardBefore);
  });

  it('deleteTag removes an unused tag', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const created = expectValue(createTag(ward, sequentialIds('unused'), 'Unused label'));
    const boards = [proposal.baseline, current, proposal.board];

    const removed = expectValue(deleteTag(created.ward, boards, created.tagId));

    expect(removed.ward.tags[created.tagId]).toBeUndefined();
    expect(Object.keys(removed.ward.tags)).toEqual(Object.keys(ward.tags));
    expect(removed.ward.members).toEqual(ward.members);
    expect(removed.boards).toEqual(boards);
    expect(removed.boards.map((board) => board.version)).toEqual(boards.map((board) => board.version));
  });

  it('tagUsage with an empty board list counts members only', () => {
    const { ward } = buildFixtureWard();
    const teaches = tagByName(ward, 'Teaches well');

    expect(tagUsage(ward, [], teaches)).toEqual({ members: 5, callingPreferences: 0, callingTags: 0 });
  });

  it('preferenceMatches is empty when the assignment has no preferences', () => {
    const { ward, current } = buildFixtureWard();
    const bishop = assignmentNamed(current, 'Bishopric', 'Bishop');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    expect(bishop.preferredMemberTagIds).toEqual([]);
    expect(ward.members[ivy]?.tagIds.length).toBeGreaterThan(0);

    expect(preferenceMatches(current, ward, bishop.id, ivy)).toEqual([]);
  });
});
