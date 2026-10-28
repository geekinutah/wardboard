import {
  callingsOf,
  preferenceMatches,
  vacancies,
  type Board,
  type MemberId,
  type PositionId,
  type Ward,
} from '@wardboard/core';

export interface PhonePersonCallingRow {
  readonly positionId: string;
  readonly assignmentId: string;
  readonly title: string;
  readonly orgLabel: string;
}

export interface PhonePersonSheetModel {
  readonly memberId: string;
  readonly name: string;
  readonly categoryLabel: 'Adult' | 'Youth';
  readonly tagNames: readonly string[];
  readonly needsApproval: boolean;
  readonly externalCallings: readonly { readonly unit: string; readonly title: string }[];
  readonly callings: readonly PhonePersonCallingRow[];
  readonly inExplicitDugout: boolean;
}

export interface PhoneVacantDestinationRow {
  readonly key: string;
  readonly target:
    | { readonly kind: 'single'; readonly positionId: string }
    | { readonly kind: 'list'; readonly assignmentId: string };
  readonly title: string;
  readonly orgLabel: string;
  readonly matchedTagNames: readonly string[];
}

export function buildPersonSheetModel(
  board: Board,
  ward: Ward,
  memberId: string,
): PhonePersonSheetModel | null {
  const member = ward.members[memberId as MemberId];
  if (member === undefined) {
    return null;
  }

  const categoryLabel: 'Adult' | 'Youth' = member.category === 'adult' ? 'Adult' : 'Youth';
  const tagNames = member.tagIds
    .map((id) => ward.tags[id]?.name)
    .filter((name): name is string => name !== undefined);

  const held = callingsOf(board, memberId as MemberId);
  const callings: PhonePersonCallingRow[] = held.map((entry) => {
    const boardGroup = board.boardGroups[entry.boardGroupId];
    const callingGroup = board.callingGroups[entry.callingGroupId];
    const bgName = boardGroup?.name ?? entry.boardGroupId;
    const cgName = callingGroup?.name ?? entry.callingGroupId;
    const orgLabel = bgName === cgName ? bgName : `${bgName} \u00B7 ${cgName}`;
    return {
      positionId: entry.positionId,
      assignmentId: entry.assignmentId,
      title: entry.title,
      orgLabel,
    };
  });

  const inExplicitDugout = board.dugoutInclusions.includes(memberId as MemberId);

  return {
    memberId: member.id,
    name: member.name,
    categoryLabel,
    tagNames,
    needsApproval: member.needsApproval,
    externalCallings: member.externalCallings,
    callings,
    inExplicitDugout,
  };
}

export function buildVacantDestinations(
  board: Board,
  ward: Ward,
  memberId: string,
  query?: string,
): readonly PhoneVacantDestinationRow[] {
  const allVacancies = vacancies(board);
  const rows: PhoneVacantDestinationRow[] = [];
  const seenListAssignments = new Set<string>();

  // Determine which list assignments this member already occupies:
  const memberPlacements = new Set<string>();
  for (const [posId, occId] of Object.entries(board.placements)) {
    if (occId === memberId) {
      const pos = board.positions[posId as PositionId];
      if (pos !== undefined) {
        memberPlacements.add(pos.assignmentId);
      }
    }
  }

  for (const vacancy of allVacancies) {
    const assignment = board.assignments[vacancy.assignmentId];
    if (assignment === undefined || !assignment.enabled) {
      continue;
    }
    const boardGroup = board.boardGroups[vacancy.boardGroupId];
    const callingGroup = board.callingGroups[vacancy.callingGroupId];
    const bgName = boardGroup?.name ?? vacancy.boardGroupId;
    const cgName = callingGroup?.name ?? vacancy.callingGroupId;
    const orgLabel = bgName === cgName ? bgName : `${bgName} \u00B7 ${cgName}`;

    if (assignment.type === 'single') {
      const matchIds = preferenceMatches(board, ward, vacancy.assignmentId, memberId as MemberId);
      const matchedTagNames = matchIds
        .map((id) => ward.tags[id]?.name)
        .filter((name): name is string => name !== undefined);
      rows.push({
        key: vacancy.positionId,
        target: { kind: 'single', positionId: vacancy.positionId },
        title: assignment.title,
        orgLabel,
        matchedTagNames,
      });
    } else {
      // List assignment: Skip the list if the member already occupies a position in that list assignment
      if (memberPlacements.has(assignment.id)) {
        continue;
      }
      // Collapse multiple vacant positions of the same assignmentId into a single row
      if (seenListAssignments.has(assignment.id)) {
        continue;
      }
      seenListAssignments.add(assignment.id);

      const matchIds = preferenceMatches(board, ward, vacancy.assignmentId, memberId as MemberId);
      const matchedTagNames = matchIds
        .map((id) => ward.tags[id]?.name)
        .filter((name): name is string => name !== undefined);
      rows.push({
        key: vacancy.assignmentId,
        target: { kind: 'list', assignmentId: vacancy.assignmentId },
        title: assignment.title,
        orgLabel,
        matchedTagNames,
      });
    }
  }

  const q = query !== undefined ? query.trim().toLowerCase() : '';
  if (q === '') {
    return rows;
  }
  return rows.filter((row) => {
    return (
      row.title.toLowerCase().includes(q) ||
      row.orgLabel.toLowerCase().includes(q) ||
      row.matchedTagNames.some((tag) => tag.toLowerCase().includes(q))
    );
  });
}
