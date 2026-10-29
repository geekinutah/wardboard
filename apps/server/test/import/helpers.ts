import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  tagId,
  type Approval,
  type AssignmentId,
  type AssignmentOrigin,
  type AssignmentType,
  type Board,
  type BoardGroup,
  type BoardGroupId,
  type BoardGroupKey,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type CallingGroupKind,
  type LeadershipRole,
  type Member,
  type MemberCategory,
  type MemberId,
  type Oversight,
  type Position,
  type PositionId,
  type Tag,
  type Ward,
} from '@wardboard/core';
import type { ImportBundle, OutOfUnitSection } from '@wardboard/importer';
import { unwrap } from '../store/helpers.ts';

export const REPORT_DATE = '2026-03-15';
export const UNIT_NAME = 'Cedar 14th Ward';
export const IMPORTED_AT = '2026-04-01T00:00:00.000Z';

export function importClock(): Date {
  return new Date(IMPORTED_AT);
}

export function person(
  id: string,
  name: string,
  extra: Partial<Omit<Member, 'id'>> = {},
): Member {
  return {
    name,
    category: 'adult',
    photoRef: null,
    note: null,
    tagIds: [],
    needsApproval: false,
    removedDate: null,
    externalCallings: [],
    ...extra,
    id: memberId(id),
  };
}

export function tag(id: string, name: string): Tag {
  return { id: tagId(id), name };
}

type PositionSpec = {
  id: string;
  lineageId: string;
  order?: number;
  memberId?: string | null;
};

type AssignmentSpec = {
  id: string;
  title: string;
  type?: AssignmentType;
  origin?: AssignmentOrigin;
  order?: number;
  leadershipRole?: LeadershipRole | null;
  positions: readonly PositionSpec[];
};

type CallingGroupSpec = {
  id: string;
  name: string;
  order?: number;
  kind?: CallingGroupKind;
  key?: string | null;
  assignments?: readonly AssignmentSpec[];
};

type BoardGroupSpec = {
  id: string;
  name: string;
  key: BoardGroupKey | null;
  order?: number;
  visible?: boolean;
  callingGroups?: readonly CallingGroupSpec[];
};

export function buildCurrent(input: {
  members: readonly Member[];
  tags?: readonly Tag[];
  groups: readonly BoardGroupSpec[];
  oversight?: readonly Oversight[];
  dugout?: readonly string[];
  approvals?: readonly Approval[];
  version?: number;
}): { ward: Ward; current: Board } {
  const tags: Record<string, Tag> = {};
  for (const item of input.tags ?? []) tags[item.id] = item;
  const members: Record<string, Member> = {};
  for (const member of input.members) members[member.id] = member;

  const boardGroups: Record<BoardGroupId, BoardGroup> = {};
  const callingGroups: Record<CallingGroupId, CallingGroup> = {};
  const assignments: Record<AssignmentId, CallingAssignment> = {};
  const positions: Record<PositionId, Position> = {};
  const placements: Record<PositionId, MemberId> = {};

  input.groups.forEach((group, groupIndex) => {
    const groupKey = boardGroupId(group.id);
    boardGroups[groupKey] = {
      id: groupKey,
      name: group.name,
      order: group.order ?? groupIndex,
      visible: group.visible ?? true,
      key: group.key,
    };
    (group.callingGroups ?? []).forEach((calling, callingIndex) => {
      const callingKey = callingGroupId(calling.id);
      callingGroups[callingKey] = {
        id: callingKey,
        name: calling.name,
        order: calling.order ?? callingIndex,
        parent: { kind: 'boardGroup', id: groupKey },
        kind: calling.kind ?? 'other',
        key: calling.key ?? null,
      };
      (calling.assignments ?? []).forEach((assignment, assignmentIndex) => {
        const assignmentKey = assignmentId(assignment.id);
        assignments[assignmentKey] = {
          id: assignmentKey,
          groupId: callingKey,
          title: assignment.title,
          type: assignment.type ?? 'single',
          order: assignment.order ?? assignmentIndex,
          enabled: true,
          prominent: false,
          origin: assignment.origin ?? 'standard',
          leadershipRole: assignment.leadershipRole ?? null,
          callingTagIds: [],
          preferredMemberTagIds: [],
        };
        assignment.positions.forEach((position, positionIndex) => {
          const positionKey = positionId(position.id);
          positions[positionKey] = {
            id: positionKey,
            assignmentId: assignmentKey,
            lineageId: lineageId(position.lineageId),
            order: position.order ?? positionIndex,
          };
          if (position.memberId !== undefined && position.memberId !== null) {
            placements[positionKey] = memberId(position.memberId);
          }
        });
      });
    });
  });

  const ward = unwrap(createWard({ members, tags }));
  const current = unwrap(
    createBoard(
      {
        id: boardId('board-current'),
        kind: 'current',
        version: input.version ?? 0,
        boardGroups,
        callingGroups,
        assignments,
        positions,
        placements,
        oversight: [...(input.oversight ?? [])],
        dugoutInclusions: (input.dugout ?? []).map((id) => memberId(id)),
        approvals: [...(input.approvals ?? [])],
      },
      ward,
    ),
  );
  return { ward, current };
}

type ReportPosition = { title: string; occupant: string | null; custom?: boolean };
type ReportGroup = { name: string; positions: readonly ReportPosition[] };
type ReportOrg = { name: string; groups: readonly ReportGroup[] };

export function bundle(input: {
  organizations?: readonly ReportOrg[];
  candidates?: readonly { name: string; category: MemberCategory }[];
  externalCallings?: readonly {
    section: OutOfUnitSection;
    name: string;
    calling: string;
    servingUnit: string | null;
  }[];
  orgDate?: string;
  withoutDate?: string;
  outDate?: string;
  unitName?: string;
}): ImportBundle {
  const unitName = input.unitName ?? UNIT_NAME;
  const orgDate = input.orgDate ?? REPORT_DATE;
  const candidates = input.candidates ?? [];
  return {
    organizations: {
      kind: 'organizations',
      unitName,
      reportDate: orgDate,
      organizations: (input.organizations ?? []).map((organization) => ({
        name: organization.name,
        groups: organization.groups.map((group) => ({
          name: group.name,
          positions: group.positions.map((position) => ({
            title: position.title,
            custom: position.custom ?? false,
            occupant: position.occupant,
          })),
        })),
      })),
    },
    withoutCallings: {
      kind: 'without-callings',
      unitName,
      reportDate: input.withoutDate ?? orgDate,
      listedCount: candidates.length,
      excludedUnder11: 0,
      candidates: candidates.map((candidate) => ({ name: candidate.name, category: candidate.category })),
    },
    outOfUnit: {
      kind: 'out-of-unit',
      unitName,
      reportDate: input.outDate ?? orgDate,
      externalCallings: (input.externalCallings ?? []).map((calling) => ({
        section: calling.section,
        name: calling.name,
        calling: calling.calling,
        servingUnit: calling.servingUnit,
      })),
    },
  };
}

export function row(
  organization: string,
  group: string,
  positions: readonly ReportPosition[],
): ReportOrg {
  return { name: organization, groups: [{ name: group, positions }] };
}
