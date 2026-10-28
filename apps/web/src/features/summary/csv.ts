import {
  diffBoards,
  rootBoardGroupOf,
  vacancies,
  type Board,
  type BoardGroupId,
  type CallingGroupId,
  type DiffPlacement,
  type MemberId,
  type Proposal,
  type Ward,
} from '@wardboard/core';

/*
 * Client-side CSV export for the summary page (SPEC §3). The CSV string is the
 * pure, unit-tested seam; the download button only wraps it in a Blob.
 */

/** RFC 4180: quote a field when it contains a comma, double quote, or newline. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function csvLine(section: string, who: string, what: string): string {
  return [section, who, what].map(csvField).join(',');
}

/**
 * The CSV summary: a header row, every suggested calling, every suggested
 * release, then one row per remaining vacancy on the proposed board, all in
 * core order. Divergence and position changes are not part of the export.
 */
export function summaryCsv(proposal: Proposal, current: Board, ward: Ward): string {
  const board = proposal.board;
  const baseline = proposal.baseline;
  const lines: string[] = ['Section,Who,What'];

  for (const placement of diffBoards(baseline, board).callings) {
    lines.push(csvLine('Suggested calling', memberName(ward, placement.memberId), whatOf(board, placement)));
  }
  for (const placement of diffBoards(baseline, board).releases) {
    lines.push(csvLine('Suggested release', memberName(ward, placement.memberId), whatOf(baseline, placement)));
  }
  for (const vacancy of vacancies(board)) {
    const position = board.positions[vacancy.positionId];
    const assignment = position !== undefined ? board.assignments[position.assignmentId] : undefined;
    if (assignment === undefined) {
      continue;
    }
    lines.push(csvLine('Remaining vacancy', boardGroupName(board, vacancy.callingGroupId), assignment.title));
  }
  return lines.join('\n');
}

/** Characters allowed in a filename without escaping. */
const SAFE_FILENAME_CHARACTERS = /[a-zA-Z0-9 . -]/u;

/**
 * A safe filename base from a proposal name: each character outside
 * `[a-zA-Z0-9 . -]` becomes `-`, runs of `-` collapse, and leading/trailing
 * `-` are trimmed. An empty result falls back to `summary`.
 */
export function summaryFilename(proposalName: string): string {
  const base = proposalName
    .split('')
    .map((character) => (SAFE_FILENAME_CHARACTERS.test(character) ? character : '-'))
    .join('')
    .replace(/-{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `${base === '' ? 'summary' : base}.csv`;
}

// -- internal lookups --------------------------------------------------------

function memberName(ward: Ward, memberId: MemberId): string {
  return ward.members[memberId]?.name ?? '';
}

function boardGroupName(board: Board, callingGroupId: CallingGroupId): string {
  const boardGroupId: BoardGroupId = rootBoardGroupOf(board, callingGroupId);
  const group = board.boardGroups[boardGroupId];
  if (group === undefined) {
    throw new Error(`board group ${boardGroupId} is missing from board ${board.id}`);
  }
  return group.name;
}

/** `{org} · {title}` for a placement, resolved on the board it belongs to. */
function whatOf(board: Board, placement: DiffPlacement): string {
  const position = board.positions[placement.positionId];
  const assignment = position !== undefined ? board.assignments[position.assignmentId] : undefined;
  if (assignment === undefined) {
    return placement.title;
  }
  return `${boardGroupName(board, assignment.groupId)} · ${assignment.title}`;
}
