import { describe, expect, it } from 'vitest';
import { boardId, createProposal, proposalId, userId, type ProposalInput } from '../../src/index.ts';
import { errorsOf, minimalBoard, testWard, valueOf } from './helpers.ts';

const ward = testWard();

function proposalInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    id: proposalId('pr-1'),
    name: 'Spring changes',
    rationale: null,
    status: 'draft',
    accepted: null,
    baseline: minimalBoard({ id: boardId('b-base'), kind: 'baseline' }),
    board: minimalBoard({ id: boardId('b-prop'), kind: 'proposal' }),
    tabOrder: 0,
    createdAt: '2026-01-04T12:00:00Z',
    updatedAt: '2026-01-04T12:00:00Z',
    ...overrides,
  };
}

function described(input: ProposalInput): string[] {
  return errorsOf(createProposal(input, ward)).map((e) => `${e.code} ${e.path}`);
}

describe('createProposal', () => {
  it('createProposal accepts a valid draft and a valid accepted proposal', () => {
    const draft = proposalInput({ rationale: 'Fill Primary vacancies.' });
    const accepted = proposalInput({
      status: 'accepted',
      accepted: { by: userId('u-1'), at: '2026-01-05T09:30:00Z', summary: 'Call Ada Fictional as Primary teacher.' },
    });

    expect(valueOf(createProposal(draft, ward))).toEqual(draft);
    expect(valueOf(createProposal(accepted, ward))).toEqual(accepted);
  });

  it('createProposal validates kinds and acceptance', () => {
    expect(described(proposalInput({ baseline: minimalBoard({ id: boardId('b-base'), kind: 'proposal' }) }))).toEqual([
      'board_kind baseline.kind',
    ]);
    expect(described(proposalInput({ board: minimalBoard({ id: boardId('b-prop'), kind: 'current' }) }))).toEqual([
      'board_kind board.kind',
    ]);
    expect(described(proposalInput({ status: 'accepted', accepted: null }))).toEqual(['invalid_field accepted']);
    expect(
      described(proposalInput({ status: 'draft', accepted: { by: userId('u-1'), at: '2026-01-05T09:30:00Z', summary: '' } })),
    ).toEqual(['invalid_field accepted']);
  });

  it('createProposal prefixes errors inside boards with baseline. and board.', () => {
    const input = proposalInput({
      baseline: minimalBoard({ id: boardId('b-base'), kind: 'baseline', version: -1 }),
      board: minimalBoard({ id: boardId('b-prop'), kind: 'proposal', positions: {}, placements: {} }),
    });

    expect(described(input)).toEqual(['invalid_field baseline.version', 'single_position_count board.assignments.a-1']);
  });

  it('createProposal validates its own fields and reports them together', () => {
    const input = proposalInput({
      id: proposalId(''),
      name: '  ',
      rationale: 7 as unknown as null,
      status: 'archived' as unknown as 'draft',
      tabOrder: -1,
      createdAt: 'yesterday',
      updatedAt: '2026-01-04 12:00:00',
    });

    expect(described(input).sort()).toEqual([
      'invalid_field createdAt',
      'invalid_field id',
      'invalid_field name',
      'invalid_field rationale',
      'invalid_field status',
      'invalid_field tabOrder',
      'invalid_field updatedAt',
    ]);
  });

  it('createProposal validates acceptance details', () => {
    const input = proposalInput({
      status: 'accepted',
      accepted: { by: userId(''), at: '2026-01-05', summary: 'ok' },
    });

    expect(described(input)).toEqual(['invalid_field accepted.by', 'invalid_field accepted.at']);
  });

  it('constructed proposals are deeply frozen and trimmed', () => {
    const proposal = valueOf(createProposal(proposalInput({ name: ' Spring changes ' }), ward));

    expect(proposal.name).toBe('Spring changes');
    expect(Object.isFrozen(proposal.board.placements)).toBe(true);
    expect(() => {
      (proposal as { name: string }).name = 'changed';
    }).toThrow(TypeError);
  });
});
