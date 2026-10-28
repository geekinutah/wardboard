import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createProposal,
  createWard,
  lineageId,
  memberId,
  positionId,
  proposalId,
  sequentialIds,
  type AssignmentId,
  type AssignmentType,
  type Board,
  type BoardGroupId,
  type BoardGroup,
  type BoardKind,
  type CallingAssignment,
  type CallingGroupId,
  type CallingGroup,
  type Member,
  type MemberId,
  type Position,
  type PositionId,
  type Proposal,
  type Result,
  type Ward,
} from '@wardboard/core';

/*
 * Small deterministic builders of fictional wards and boards for the summary
 * feature tests. Every name here is invented. Lineage ids are assigned in spec
 * order, so boards built from the same shape share lineages and `diffBoards`
 * matches their positions across boards.
 */

export interface AssignmentSpec {
  readonly title: string;
  readonly type: AssignmentType;
  /** One entry per position: the occupant's member name, or null for a vacancy. */
  readonly occupants: readonly (string | null)[];
}

export interface GroupSpec {
  readonly name: string;
  readonly assignments: readonly AssignmentSpec[];
}

export interface OrgSpec {
  readonly name: string;
  readonly groups: readonly GroupSpec[];
}

function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

/** Builds a ward whose members are exactly `names`, in order, with no tags. */
export function buildWard(names: readonly string[]): Ward {
  const nextMember = sequentialIds('m');
  const members: Record<MemberId, Member> = {};
  for (const name of names) {
    const id = memberId(nextMember());
    members[id] = {
      id,
      name,
      category: 'adult',
      photoRef: null,
      note: null,
      tagIds: [],
      needsApproval: false,
      removedDate: null,
      externalCallings: [],
    };
  }
  return unwrap(createWard({ members, tags: {} }), 'ward');
}

export interface BuildBoardOptions {
  readonly kind: BoardKind;
  readonly id: string;
}

/**
 * Builds a board from the spec. Board groups, calling groups, assignments and
 * positions are numbered in spec order, so equal specs yield equal lineages.
 */
export function buildBoard(spec: readonly OrgSpec[], options: BuildBoardOptions, ward: Ward): Board {
  const nextBoardGroup = sequentialIds('bg');
  const nextCallingGroup = sequentialIds('cg');
  const nextAssignment = sequentialIds('a');
  const nextPosition = sequentialIds('p');
  const memberIdByName = new Map<string, MemberId>();
  for (const member of Object.values(ward.members)) {
    memberIdByName.set(member.name, member.id);
  }

  const boardGroups: Record<BoardGroupId, BoardGroup> = {};
  const callingGroups: Record<CallingGroupId, CallingGroup> = {};
  const assignments: Record<AssignmentId, CallingAssignment> = {};
  const positions: Record<PositionId, Position> = {};
  const placements: Record<PositionId, MemberId> = {};

  spec.forEach((org, orgOrder) => {
    const bgId = boardGroupId(nextBoardGroup());
    boardGroups[bgId] = { id: bgId, name: org.name, order: orgOrder, visible: true, key: null };
    org.groups.forEach((group, groupOrder) => {
      const cgId = callingGroupId(nextCallingGroup());
      callingGroups[cgId] = {
        id: cgId,
        name: group.name,
        order: groupOrder,
        parent: { kind: 'boardGroup', id: bgId },
        kind: 'other',
        key: null,
      };
      group.assignments.forEach((assignmentSpec, assignmentOrder) => {
        const aId = assignmentId(nextAssignment());
        assignments[aId] = {
          id: aId,
          groupId: cgId,
          title: assignmentSpec.title,
          type: assignmentSpec.type,
          order: assignmentOrder,
          enabled: true,
          prominent: false,
          origin: 'standard',
          leadershipRole: null,
          callingTagIds: [],
          preferredMemberTagIds: [],
        };
        assignmentSpec.occupants.forEach((occupant, positionOrder) => {
          const pId = positionId(nextPosition());
          positions[pId] = {
            id: pId,
            assignmentId: aId,
            // Content-based: equal specs yield equal lineages, and a position
            // under a new org/group/title gets a lineage no other board has.
            lineageId: lineageId(`ln:${org.name}:${group.name}:${assignmentSpec.title}:${String(positionOrder)}`),
            order: positionOrder,
          };
          if (occupant !== null) {
            const occupantId = memberIdByName.get(occupant);
            if (occupantId === undefined) {
              throw new Error(`fixture references unknown member ${occupant}`);
            }
            placements[pId] = occupantId;
          }
        });
      });
    });
  });

  return unwrap(
    createBoard(
      {
        id: boardId(options.id),
        kind: options.kind,
        version: 1,
        boardGroups,
        callingGroups,
        assignments,
        positions,
        placements,
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      ward,
    ),
    `board ${options.id}`,
  );
}

export interface BuildProposalOptions {
  readonly name?: string;
  readonly rationale?: string | null;
  readonly createdAt?: string;
}

/** Builds a draft proposal from a baseline and a board. */
export function buildProposal(baseline: Board, board: Board, ward: Ward, options: BuildProposalOptions = {}): Proposal {
  const createdAt = options.createdAt ?? '2026-10-19T12:00:00Z';
  return unwrap(
    createProposal(
      {
        id: proposalId('pr-0001'),
        name: options.name ?? 'Test proposal',
        rationale: options.rationale ?? null,
        status: 'draft',
        accepted: null,
        baseline,
        board,
        tabOrder: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ward,
    ),
    'proposal',
  );
}
