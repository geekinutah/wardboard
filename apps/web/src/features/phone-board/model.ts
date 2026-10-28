import {
  boardGroupId,
  groupDetail,
  overseerOf,
  wardOverview,
  type Board,
  type DetailSection,
  type MemberId,
  type Overseer,
  type Ward,
} from '@wardboard/core';

export interface PhoneOrgListRow {
  readonly boardGroupId: string;
  readonly name: string;
  readonly changeLabel: string;
  readonly vacantLabel: string;
}

export interface PhonePositionRow {
  readonly positionId: string;
  readonly memberId: string | null;
  readonly name: string;
  readonly title: string;
  readonly proposed: boolean;
}

export interface PhoneOrgSection {
  readonly callingGroupId: string;
  readonly heading: string;
  readonly rows: readonly PhonePositionRow[];
}

export interface PhoneOrganization {
  readonly boardGroupId: string;
  readonly name: string;
  readonly vacantLabel: string;
  readonly overseerText: string;
  readonly sections: readonly PhoneOrgSection[];
}

const COUNT_SEPARATOR = ' \u00B7 ';

export function proposedChangeLabel(changeCount: number): string {
  if (changeCount === 0) {
    return 'No changes';
  }
  if (changeCount === 1) {
    return '1 proposed change';
  }
  return `${String(changeCount)} proposed changes`;
}

export function phoneOrgList(board: Board, baseline: Board | null): readonly PhoneOrgListRow[] {
  return wardOverview(board, baseline).map((tile) => ({
    boardGroupId: tile.boardGroupId,
    name: tile.name,
    changeLabel: proposedChangeLabel(tile.changeCount),
    vacantLabel: `${String(tile.vacantCount)} vacant`,
  }));
}

function overseerLabel(overseer: Overseer): string {
  switch (overseer) {
    case 'bishop':
      return 'Bishop';
    case 'first_counselor':
      return 'First Counselor';
    case 'second_counselor':
      return 'Second Counselor';
  }
}

function compareOrderThenId(
  left: { readonly order: number; readonly id: string },
  right: { readonly order: number; readonly id: string },
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.id.localeCompare(right.id, 'en');
}

function occupantName(ward: Ward, memberId: MemberId | null): string {
  if (memberId === null) {
    return 'Vacant';
  }
  const member = ward.members[memberId];
  return member === undefined ? 'Unknown' : member.name;
}

function rowsForSection(ward: Ward, section: DetailSection): PhonePositionRow[] {
  const rows: PhonePositionRow[] = [];
  for (const assignment of section.assignments) {
    for (const position of assignment.positions) {
      rows.push({
        positionId: position.positionId,
        memberId: position.memberId,
        name: occupantName(ward, position.memberId),
        title: assignment.title,
        proposed: position.proposed,
      });
    }
  }
  return rows;
}

function sectionHeading(board: Board, section: DetailSection): string {
  const group = board.callingGroups[section.callingGroupId];
  const name = group === undefined ? section.name : group.name;
  if (group === undefined || group.kind === 'presidency' || group.kind === 'bishopric') {
    return name;
  }
  let filled = 0;
  let total = 0;
  for (const assignment of section.assignments) {
    filled += assignment.filledCount;
    total += assignment.positions.length;
  }
  return `${name}${COUNT_SEPARATOR}${String(filled)} of ${String(total)}`;
}

/** The calling-group name, without the filled-of-total suffix on the heading. */
export function callingGroupNameFromHeading(heading: string): string {
  return heading.replace(/ \u00B7 \d+ of \d+$/u, '');
}

export function phoneOrganization(
  board: Board,
  ward: Ward,
  baseline: Board | null,
  id: string,
): PhoneOrganization | null {
  const resolvedId = boardGroupId(id);
  const boardGroup = board.boardGroups[resolvedId];
  if (boardGroup === undefined) {
    return null;
  }

  const topLevel = Object.values(board.callingGroups)
    .filter((group) => group.parent.kind === 'boardGroup' && group.parent.id === boardGroup.id)
    .sort(compareOrderThenId);

  const sections: PhoneOrgSection[] = [];
  for (const group of topLevel) {
    const detail = groupDetail(board, ward, group.id, baseline);
    for (const section of detail.sections) {
      const rows = rowsForSection(ward, section);
      if (rows.length === 0) {
        continue;
      }
      sections.push({
        callingGroupId: section.callingGroupId,
        heading: sectionHeading(board, section),
        rows,
      });
    }
  }

  let vacant = 0;
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.memberId === null) {
        vacant += 1;
      }
    }
  }

  const overseer = overseerOf(board, { kind: 'boardGroup', id: boardGroup.id });
  return {
    boardGroupId: boardGroup.id,
    name: boardGroup.name,
    vacantLabel: `${String(vacant)} vacant`,
    overseerText: `Overseen by ${overseerLabel(overseer)}`,
    sections,
  };
}
