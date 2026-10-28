import type { ProposalStatus } from '@wardboard/core';
import { describe, expect, it } from 'vitest';
import { boardEditability } from './editability.ts';

function proposal(status: ProposalStatus): { status: ProposalStatus } {
  return { status };
}

describe('boardEditability', () => {
  it('current is never editable, even with a draft proposal view', () => {
    expect(boardEditability({ kind: 'current' }, proposal('draft'))).toEqual({
      editable: false,
      reason: 'current',
    });
    expect(boardEditability({ kind: 'current' }, proposal('accepted'))).toEqual({
      editable: false,
      reason: 'current',
    });
    expect(boardEditability({ kind: 'current' }, null)).toEqual({
      editable: false,
      reason: 'current',
    });
  });

  it('baseline is never editable', () => {
    expect(boardEditability({ kind: 'baseline' }, null)).toEqual({
      editable: false,
      reason: 'baseline',
    });
    expect(boardEditability({ kind: 'baseline' }, proposal('draft'))).toEqual({
      editable: false,
      reason: 'baseline',
    });
  });

  it('draft proposal is editable; accepted is not', () => {
    expect(boardEditability({ kind: 'proposal' }, proposal('draft'))).toEqual({ editable: true });
    expect(boardEditability({ kind: 'proposal' }, proposal('accepted'))).toEqual({
      editable: false,
      reason: 'accepted',
    });
  });

  it('proposal board without a proposal view fails closed', () => {
    expect(boardEditability({ kind: 'proposal' }, null)).toEqual({
      editable: false,
      reason: 'unknown',
    });
  });
});
