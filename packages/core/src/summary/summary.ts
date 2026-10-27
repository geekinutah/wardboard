import { rootBoardGroupOf } from '../derive/views.ts';
import { proposalDiff } from '../diff/diff.ts';
import type { DiffPlacement } from '../diff/types.ts';
import { deepFreeze } from '../model/freeze.ts';
import type { MemberId } from '../model/ids.ts';
import type { Board, BoardGroup, CallingAssignment, CallingGroup, Position, Proposal, Ward } from '../model/types.ts';
import { assertNever } from '../util/assert-never.ts';
import { overseerOf } from './oversight.ts';
import { SUMMARY_GROUP_KEYS, type SummaryGroup, type SummaryGroupKey, type SummaryLine } from './types.ts';

/*
 * Accepted callings-and-releases summary (SPEC §3, §12). Lines come from
 * `proposalDiff` and are grouped by who oversees the position's calling group.
 * Elders Quorum is the exception: its presidency is reported for the stake
 * presidency, and its other callings for the elders quorum president. Added
 * and removed positions are not lines. The proposal's status is ignored.
 */

const EM_DASH = '\u2014';
const SEPARATOR = ' \u00b7 ';

function headingFor(key: SummaryGroupKey): string {
  switch (key) {
    case 'bishop':
      return 'Bishop';
    case 'first_counselor':
      return 'First Counselor';
    case 'second_counselor':
      return 'Second Counselor';
    case 'eq_presidency_stake':
      return `Elders Quorum presidency ${EM_DASH} for the stake presidency`;
    case 'eq_president':
      return 'Elders Quorum president';
    default:
      return assertNever(key);
  }
}

function positionByLineage(board: Board, lineageId: DiffPlacement['lineageId']): Position | undefined {
  return Object.values(board.positions).find((position) => position.lineageId === lineageId);
}

function requirePosition(board: Board, placement: DiffPlacement): Position {
  const position = positionByLineage(board, placement.lineageId) ?? board.positions[placement.positionId];
  if (position === undefined) {
    throw new TypeError(`position ${placement.positionId} does not exist on board ${board.id}`);
  }
  return position;
}

function requireAssignment(board: Board, position: Position): CallingAssignment {
  const assignment = board.assignments[position.assignmentId];
  if (assignment === undefined) {
    throw new TypeError(`assignment ${position.assignmentId} does not exist on board ${board.id}`);
  }
  return assignment;
}

function requireCallingGroup(board: Board, assignment: CallingAssignment): CallingGroup {
  const group = board.callingGroups[assignment.groupId];
  if (group === undefined) {
    throw new TypeError(`calling group ${assignment.groupId} does not exist on board ${board.id}`);
  }
  return group;
}

function requireBoardGroup(board: Board, callingGroup: CallingGroup): BoardGroup {
  const rootId = rootBoardGroupOf(board, callingGroup.id);
  const group = board.boardGroups[rootId];
  if (group === undefined) {
    throw new TypeError(`board group ${rootId} does not exist on board ${board.id}`);
  }
  return group;
}

function memberName(ward: Ward, memberId: MemberId): string {
  const member = ward.members[memberId];
  if (member === undefined) {
    throw new TypeError(`member ${memberId} does not exist`);
  }
  return member.name;
}

function lineText(name: string, boardGroupName: string, callingGroupName: string, title: string): string {
  const segments = [boardGroupName];
  if (callingGroupName !== boardGroupName) {
    segments.push(callingGroupName);
  }
  segments.push(title);
  return `${name} ${EM_DASH} ${segments.join(SEPARATOR)}`;
}

function groupKeyFor(board: Board, callingGroup: CallingGroup, root: BoardGroup): SummaryGroupKey {
  if (root.key === 'elders_quorum') {
    return callingGroup.kind === 'presidency' ? 'eq_presidency_stake' : 'eq_president';
  }
  return overseerOf(board, { kind: 'callingGroup', id: callingGroup.id });
}

function classify(board: Board, placement: DiffPlacement, ward: Ward): { key: SummaryGroupKey; line: SummaryLine } {
  const position = requirePosition(board, placement);
  const assignment = requireAssignment(board, position);
  const callingGroup = requireCallingGroup(board, assignment);
  const root = requireBoardGroup(board, callingGroup);
  const name = memberName(ward, placement.memberId);
  return {
    key: groupKeyFor(board, callingGroup, root),
    line: {
      memberId: placement.memberId,
      name,
      positionId: placement.positionId,
      text: lineText(name, root.name, callingGroup.name, assignment.title),
    },
  };
}

function boardForRelease(proposal: Proposal, placement: DiffPlacement): Board {
  if (positionByLineage(proposal.board, placement.lineageId) === undefined) {
    return proposal.baseline;
  }
  return proposal.board;
}

function pushLine(into: Map<SummaryGroupKey, SummaryLine[]>, key: SummaryGroupKey, line: SummaryLine): void {
  const lines = into.get(key);
  if (lines === undefined) {
    into.set(key, [line]);
    return;
  }
  lines.push(line);
}

/**
 * Callings and releases from `proposal` to `ward`, grouped for the accepted
 * summary. Groups with no lines are omitted. `proposal` and `ward` are not mutated.
 */
export function acceptedSummary(proposal: Proposal, ward: Ward): readonly SummaryGroup[] {
  const diff = proposalDiff(proposal);
  const callings = new Map<SummaryGroupKey, SummaryLine[]>();
  const releases = new Map<SummaryGroupKey, SummaryLine[]>();
  for (const placement of diff.callings) {
    const classified = classify(proposal.board, placement, ward);
    pushLine(callings, classified.key, classified.line);
  }
  for (const placement of diff.releases) {
    const classified = classify(boardForRelease(proposal, placement), placement, ward);
    pushLine(releases, classified.key, classified.line);
  }
  const groups: SummaryGroup[] = [];
  for (const key of SUMMARY_GROUP_KEYS) {
    const groupCallings = callings.get(key) ?? [];
    const groupReleases = releases.get(key) ?? [];
    if (groupCallings.length === 0 && groupReleases.length === 0) {
      continue;
    }
    groups.push({ key, heading: headingFor(key), callings: groupCallings, releases: groupReleases });
  }
  return deepFreeze(groups);
}

/** One group's plain text. Empty callings or releases sections are omitted. */
export function summaryText(group: SummaryGroup): string {
  const lines = [group.heading];
  if (group.callings.length > 0) {
    lines.push('Callings:');
    for (const calling of group.callings) {
      lines.push(`- ${calling.text}`);
    }
  }
  if (group.releases.length > 0) {
    lines.push('Releases:');
    for (const release of group.releases) {
      lines.push(`- ${release.text}`);
    }
  }
  return lines.join('\n');
}

/** Every group's text, separated by a blank line. Empty input has its own sentence. */
export function summaryAllText(groups: readonly SummaryGroup[]): string {
  if (groups.length === 0) {
    return 'No suggested callings or releases.';
  }
  return groups.map((group) => summaryText(group)).join('\n\n');
}
