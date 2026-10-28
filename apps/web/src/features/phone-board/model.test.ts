import { describe, expect, it } from 'vitest';
import {
  placeInPosition,
  sequentialIds,
  wardOverview,
  type Board,
  type BoardGroupId,
  type MemberId,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import type { PreviewData } from '../../preview/types.ts';
import { phoneOrganization, phoneOrgList, proposedChangeLabel } from './model.ts';

function draftFixture(): PreviewData {
  return buildPreviewData({ steps: [] });
}

function boardGroupNamed(board: Board, name: string): BoardGroupId {
  const found = Object.values(board.boardGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`missing board group ${name}`);
  }
  return found.id;
}

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`missing member ${name}`);
  }
  return found.id;
}

function positionNamed(
  board: Board,
  groupName: string,
  title: string,
): { readonly positionId: PositionId; readonly memberId: MemberId | null } {
  const group = Object.values(board.callingGroups).find((item) => item.name === groupName);
  if (group === undefined) {
    throw new Error(`missing calling group ${groupName}`);
  }
  const assignment = Object.values(board.assignments).find(
    (item) => item.groupId === group.id && item.title === title,
  );
  if (assignment === undefined) {
    throw new Error(`missing assignment ${groupName} / ${title}`);
  }
  const position = Object.values(board.positions)
    .filter((item) => item.assignmentId === assignment.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, 'en'))[0];
  if (position === undefined) {
    throw new Error(`missing position ${groupName} / ${title}`);
  }
  const memberId = Object.hasOwn(board.placements, position.id) ? (board.placements[position.id] ?? null) : null;
  return { positionId: position.id, memberId };
}

function fillPrimarySecretary(data: PreviewData): Board {
  const secretary = positionNamed(data.proposal.board, 'Primary Presidency', 'Secretary');
  if (secretary.memberId !== null) {
    throw new Error('Primary Secretary is not vacant on the fixture proposal');
  }
  const result = placeInPosition(
    data.proposal.board,
    { ward: data.ward, ids: sequentialIds('t048') },
    { memberId: memberNamed(data.ward, 'Ivy Notreal'), from: null, to: secretary.positionId },
  );
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

describe('phone board model', () => {
  it('proposedChangeLabel uses singular and plural', () => {
    expect(proposedChangeLabel(0)).toBe('No changes');
    expect(proposedChangeLabel(1)).toBe('1 proposed change');
    expect(proposedChangeLabel(2)).toBe('2 proposed changes');
  });

  it('phoneOrgList follows wardOverview order and labels', () => {
    const data = draftFixture();
    const board = data.proposal.board;
    const baseline = data.proposal.baseline;
    const rows = phoneOrgList(board, baseline);
    const tiles = wardOverview(board, baseline);
    expect(rows.map((row) => row.name)).toEqual(tiles.map((tile) => tile.name));
    const names = rows.map((row) => row.name);
    expect(names.indexOf('Primary')).toBe(names.indexOf('Young Women') + 1);
    const primary = rows.find((row) => row.name === 'Primary');
    const tile = tiles.find((item) => item.name === 'Primary');
    if (primary === undefined || tile === undefined) {
      throw new Error('Primary missing from the organization list');
    }
    expect(primary.changeLabel).toBe('No changes');
    expect(primary.vacantLabel).toBe(`${String(tile.vacantCount)} vacant`);
    expect(rows.some((row) => row.name === 'Out-of-Unit')).toBe(false);
  });

  it('a placement turns the Primary change label singular', () => {
    const data = draftFixture();
    const placed = fillPrimarySecretary(data);
    const primary = phoneOrgList(placed, data.proposal.baseline).find((row) => row.name === 'Primary');
    expect(primary?.changeLabel).toBe('1 proposed change');
  });

  it('phoneOrganization describes Primary', () => {
    const data = draftFixture();
    const board = data.proposal.board;
    const org = phoneOrganization(board, data.ward, data.proposal.baseline, boardGroupNamed(board, 'Primary'));
    expect(org).not.toBeNull();
    if (org === null) {
      return;
    }
    expect(org.name).toBe('Primary');
    expect(org.overseerText).toMatch(/^Overseen by (Bishop|First Counselor|Second Counselor)$/);
    const presidency = org.sections.find((section) => section.heading === 'Primary Presidency');
    expect(presidency).toBeDefined();
    expect(presidency?.heading).not.toMatch(/ of /);
    const teachers = org.sections.find((section) => section.heading.startsWith('Primary Teachers · '));
    expect(teachers?.heading).toMatch(/ of /);
    const yara = org.sections.flatMap((section) => section.rows).find((row) => row.name === 'Yara Fictional');
    expect(yara?.title).toBe('President');
    const secretary = org.sections
      .flatMap((section) => section.rows)
      .find((row) => row.name === 'Vacant' && row.title === 'Secretary');
    expect(secretary).toBeDefined();
  });

  it('phoneOrganization marks a net new calling', () => {
    const data = draftFixture();
    const placed = fillPrimarySecretary(data);
    const primaryId = boardGroupNamed(placed, 'Primary');
    const proposed = phoneOrganization(placed, data.ward, data.proposal.baseline, primaryId);
    const secretary = proposed?.sections
      .flatMap((section) => section.rows)
      .find((row) => row.title === 'Secretary');
    expect(secretary?.name).toBe('Ivy Notreal');
    expect(secretary?.proposed).toBe(true);

    const withoutBaseline = phoneOrganization(placed, data.ward, null, primaryId);
    const currentSecretary = withoutBaseline?.sections
      .flatMap((section) => section.rows)
      .find((row) => row.title === 'Secretary');
    expect(currentSecretary?.proposed).toBe(false);
  });

  it('phoneOrganization returns null for an unknown id', () => {
    const data = draftFixture();
    expect(() =>
      phoneOrganization(data.proposal.board, data.ward, data.proposal.baseline, 'bg-missing'),
    ).not.toThrow();
    expect(phoneOrganization(data.proposal.board, data.ward, data.proposal.baseline, 'bg-missing')).toBeNull();
  });
});
