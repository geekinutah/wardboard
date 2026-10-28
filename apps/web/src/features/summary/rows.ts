import {
  diffBoards,
  removedState,
  rootBoardGroupOf,
  vacancies,
  type AssignmentId,
  type Board,
  type BoardGroupId,
  type DiffPlacement,
  type DiffPosition,
  type LineageId,
  type MemberId,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';

/*
 * Display rows for the proposal summary page (SPEC §3, §8, artboard 7). Pure:
 * core `diffBoards`, `vacancies`, `removedState` and `rootBoardGroupOf` decide
 * what counts as changed, vacant, or removed; this module only resolves names
 * and groups the results for rendering.
 */

/** A suggested calling, release, added, or trimmed position with display names. */
export interface DiffRow {
  /** The member's name; null for position rows. */
  readonly name: string | null;
  /** Name of the root board group the position's calling group belongs to. */
  readonly org: string;
  /** The assignment title on the board the position belongs to. */
  readonly title: string;
}

/** Vacant positions of the proposed board, grouped by board group. */
export interface VacancySection {
  readonly org: string;
  /** Distinct assignment titles of the section's vacant positions, in board order. */
  readonly titles: string[];
  /** Total vacant positions in the section. */
  readonly count: number;
  /** Board groups represented: 1 for an explicit section, more for the collapsed one. */
  readonly groups: number;
}

/** A position added to or removed from Current, with its state in this proposal. */
export interface DivergencePositionLine {
  readonly org: string;
  readonly title: string;
  readonly note: string;
}

/** A ward member no longer in Current, with their placements on the proposal board. */
export interface DivergenceMemberLine {
  readonly name: string;
  readonly positions: { readonly org: string; readonly title: string }[];
}

/** What Current changed relative to the proposal's saved baseline. */
export interface Divergence {
  /** Positions on Current whose lineage is absent from the baseline, in core order. */
  readonly added: DivergencePositionLine[];
  /** Baseline positions absent from Current, in core order. */
  readonly removed: DivergencePositionLine[];
  /** Ward members with a `removedDate`, in core order. */
  readonly members: DivergenceMemberLine[];
  /** added + removed + members (a removed member counts once, whatever they hold). */
  readonly total: number;
}

export interface SummaryRows {
  readonly callings: DiffRow[];
  readonly releases: DiffRow[];
  readonly added: DiffRow[];
  readonly trimmed: DiffRow[];
  readonly vacancySections: VacancySection[];
  readonly divergence: Divergence;
}

/** More than this many orgs with vacancies collapse the tail into one row. */
const MAX_EXPLICIT_VACANCY_SECTIONS = 5;

/** Name of the root board group containing the assignment's calling group. */
export function boardGroupNameOf(board: Board, assignmentId: AssignmentId): string {
  const assignment = board.assignments[assignmentId];
  if (assignment === undefined) {
    throw new Error(`assignment ${String(assignmentId)} is missing from board ${board.id}`);
  }
  const boardGroupId = rootBoardGroupOf(board, assignment.groupId);
  return boardGroupDisplayName(board, boardGroupId);
}

function boardGroupDisplayName(board: Board, boardGroupId: BoardGroupId): string {
  const group = board.boardGroups[boardGroupId];
  if (group === undefined) {
    throw new Error(`board group ${boardGroupId} is missing from board ${board.id}`);
  }
  return group.name;
}

function memberName(ward: Ward, memberId: MemberId): string | null {
  return ward.members[memberId]?.name ?? null;
}

function placementRow(placement: DiffPlacement, board: Board, ward: Ward): DiffRow {
  return {
    name: memberName(ward, placement.memberId),
    org: boardGroupNameOf(board, placement.assignmentId),
    title: placement.title,
  };
}

function positionRow(position: DiffPosition, board: Board): DiffRow {
  return {
    name: null,
    org: boardGroupNameOf(board, position.assignmentId),
    title: position.title,
  };
}

function assignmentTitleOf(board: Board, positionId: PositionId): string | null {
  const position = board.positions[positionId];
  const assignment = position !== undefined ? board.assignments[position.assignmentId] : undefined;
  return assignment?.title ?? null;
}

function vacancySectionOf(board: Board): VacancySection[] {
  const vacant = vacancies(board);
  const byGroup = new Map<BoardGroupId, { count: number; titles: string[] }>();
  const groupOrder: BoardGroupId[] = [];
  for (const vacancy of vacant) {
    let entry = byGroup.get(vacancy.boardGroupId);
    if (entry === undefined) {
      entry = { count: 0, titles: [] };
      byGroup.set(vacancy.boardGroupId, entry);
      groupOrder.push(vacancy.boardGroupId);
    }
    entry.count += 1;
    const title = assignmentTitleOf(board, vacancy.positionId);
    if (title !== null && !entry.titles.includes(title)) {
      entry.titles.push(title);
    }
  }
  const sections: VacancySection[] = [];
  for (const boardGroupId of groupOrder) {
    const group = board.boardGroups[boardGroupId];
    const entry = byGroup.get(boardGroupId);
    if (group === undefined || entry === undefined) {
      throw new Error(`board group ${boardGroupId} is missing from board ${board.id}`);
    }
    sections.push({ org: group.name, titles: entry.titles, count: entry.count, groups: 1 });
  }
  if (sections.length <= MAX_EXPLICIT_VACANCY_SECTIONS) {
    return sections;
  }
  const explicit = sections.slice(0, MAX_EXPLICIT_VACANCY_SECTIONS);
  const collapsed = sections.slice(MAX_EXPLICIT_VACANCY_SECTIONS);
  const collapsedCount = collapsed.reduce((sum, section) => sum + section.count, 0);
  return [...explicit, { org: 'Other groups', titles: [], count: collapsedCount, groups: collapsed.length }];
}

function divergenceOf(proposal: Proposal, current: Board, ward: Ward): Divergence {
  const board = proposal.board;
  const baseline = proposal.baseline;
  const diff = diffBoards(baseline, current);

  const proposalLineageToPosition = new Map<LineageId, PositionId>();
  for (const position of Object.values(board.positions)) {
    proposalLineageToPosition.set(position.lineageId, position.id);
  }

  function noteForLineage(lineageId: LineageId): string {
    const positionId = proposalLineageToPosition.get(lineageId);
    if (positionId === undefined) {
      return 'Not in this proposal';
    }
    const occupantId = Object.hasOwn(board.placements, positionId) ? board.placements[positionId] : undefined;
    const occupant = occupantId !== undefined ? ward.members[occupantId] : undefined;
    return occupant === undefined
      ? 'Still vacant in this proposal'
      : `Held in this proposal by ${occupant.name}`;
  }

  const added = diff.addedPositions.map((position): DivergencePositionLine => ({
    org: boardGroupNameOf(current, position.assignmentId),
    title: position.title,
    note: noteForLineage(position.lineageId),
  }));
  const removed = diff.removedPositions.map((position): DivergencePositionLine => ({
    org: boardGroupNameOf(baseline, position.assignmentId),
    title: position.title,
    note: noteForLineage(position.lineageId),
  }));

  const state = removedState(proposal, current, ward);
  const members = state.members.map((entry): DivergenceMemberLine => {
    const member = ward.members[entry.memberId];
    return {
      name: member?.name ?? '',
      positions: entry.positionIds.map((positionId): { org: string; title: string } => {
        const position = board.positions[positionId];
        const assignment = position !== undefined ? board.assignments[position.assignmentId] : undefined;
        return {
          org: assignment === undefined ? '' : boardGroupNameOf(board, assignment.id),
          title: assignment?.title ?? '',
        };
      }),
    };
  });

  return {
    added,
    removed,
    members,
    total: added.length + removed.length + members.length,
  };
}

/**
 * Every summary section for a proposal: net changes against its saved
 * baseline, remaining vacancies, and what Current changed since the baseline.
 */
export function summaryRows(proposal: Proposal, current: Board, ward: Ward): SummaryRows {
  const board = proposal.board;
  const baseline = proposal.baseline;
  const diff = diffBoards(baseline, board);
  return {
    callings: diff.callings.map((placement) => placementRow(placement, board, ward)),
    releases: diff.releases.map((placement) => placementRow(placement, baseline, ward)),
    added: diff.addedPositions.map((position) => positionRow(position, board)),
    trimmed: diff.removedPositions.map((position) => positionRow(position, baseline)),
    vacancySections: vacancySectionOf(board),
    divergence: divergenceOf(proposal, current, ward),
  };
}
