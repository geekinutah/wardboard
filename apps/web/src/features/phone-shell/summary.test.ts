import { describe, expect, it } from 'vitest';
import {
  assignmentId,
  lineageId,
  memberId,
  positionId,
  type NetDiff,
} from '@wardboard/core';
import {
  changeCount,
  headerSummary,
  switcherSubtitle,
  type BoardEntry,
} from './summary.ts';

describe('summary helpers', () => {
  it('headerSummary pluralizes and uses a minus sign', () => {
    expect(
      headerSummary({ kind: 'proposal', callings: 4, releases: 3, vacant: 20 }),
    ).toBe('+4 callings · −3 releases · 20 vacant');

    expect(
      headerSummary({ kind: 'proposal', callings: 1, releases: 1, vacant: 1 }),
    ).toBe('+1 calling · −1 release · 1 vacant');

    expect(
      headerSummary({ kind: 'proposal', callings: 0, releases: 0, vacant: 0 }),
    ).toBe('+0 callings · −0 releases · 0 vacant');

    expect(
      headerSummary({ kind: 'current', callings: 0, releases: 0, vacant: 20 }),
    ).toBe('20 vacant');

    // Confirm that the minus sign is U+2212 and not ASCII hyphen-minus
    const summary = headerSummary({ kind: 'proposal', callings: 1, releases: 1, vacant: 1 });
    expect(summary).toContain('\u22121 release');
    expect(summary).not.toContain('-1 release');
  });

  it('changeCount sums all four diff lists', () => {
    const emptyDiff: NetDiff = {
      callings: [],
      releases: [],
      addedPositions: [],
      removedPositions: [],
    };
    expect(changeCount(emptyDiff)).toBe(0);

    const dummyPlacement = {
      memberId: memberId('m1'),
      positionId: positionId('p1'),
      lineageId: lineageId('l1'),
      assignmentId: assignmentId('a1'),
      title: 'Teacher',
    };
    const dummyPosition = {
      positionId: positionId('p2'),
      lineageId: lineageId('l2'),
      assignmentId: assignmentId('a2'),
      title: 'Advisor',
    };

    const diffWithEntries: NetDiff = {
      callings: [dummyPlacement, dummyPlacement],
      releases: [dummyPlacement],
      addedPositions: [dummyPosition],
      removedPositions: [dummyPosition],
    };
    expect(changeCount(diffWithEntries)).toBe(5);
  });

  it('switcherSubtitle covers Current, null import date, accepted, removed items', () => {
    const currentWithDate: BoardEntry = {
      id: 'current',
      kind: 'current',
      name: 'Current',
      status: 'current',
      importedAt: '2026-10-24T12:00:00Z',
      changeCount: 0,
      removedCount: 0,
    };
    expect(switcherSubtitle(currentWithDate)).toBe('Read-only · imported Oct 24');

    const currentNullDate: BoardEntry = {
      id: 'current',
      kind: 'current',
      name: 'Current',
      status: 'current',
      importedAt: null,
      changeCount: 0,
      removedCount: 0,
    };
    expect(switcherSubtitle(currentNullDate)).toBe('Read-only');

    const acceptedProposal: BoardEntry = {
      id: 'prop-1',
      kind: 'proposal',
      name: 'Youth focus',
      status: 'accepted',
      importedAt: null,
      changeCount: 3,
      removedCount: 0,
    };
    expect(switcherSubtitle(acceptedProposal)).toBe('Accepted · 3 changes');

    const proposalWithRemoved: BoardEntry = {
      id: 'prop-2',
      kind: 'proposal',
      name: 'Spring adjustments',
      status: 'draft',
      importedAt: null,
      changeCount: 7,
      removedCount: 2,
    };
    expect(switcherSubtitle(proposalWithRemoved)).toBe('7 changes · 2 removed items');

    const singleChangeRemoved: BoardEntry = {
      id: 'prop-3',
      kind: 'proposal',
      name: 'Single change',
      status: 'draft',
      importedAt: null,
      changeCount: 1,
      removedCount: 1,
    };
    expect(switcherSubtitle(singleChangeRemoved)).toBe('1 change · 1 removed item');

    const noChanges: BoardEntry = {
      id: 'prop-4',
      kind: 'proposal',
      name: 'No edit proposal',
      status: 'draft',
      importedAt: null,
      changeCount: 0,
      removedCount: 0,
    };
    expect(switcherSubtitle(noChanges)).toBe('No changes');
  });
});
