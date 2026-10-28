import type { AssignmentId, Board, MemberId, PositionId, Ward } from '@wardboard/core';
import type { DropOp } from './types.ts';

/** A calling as people read it: its group name and title. */
export interface CallingLabel {
  readonly group: string;
  readonly title: string;
}

export function memberName(ward: Ward, id: MemberId): string {
  return ward.members[id]?.name ?? id;
}

export function assignmentLabel(board: Board, id: AssignmentId): CallingLabel {
  const assignment = board.assignments[id];
  if (assignment === undefined) {
    return { group: '', title: id };
  }
  return { group: board.callingGroups[assignment.groupId]?.name ?? '', title: assignment.title };
}

export function positionLabel(board: Board, id: PositionId): CallingLabel {
  const position = board.positions[id];
  if (position === undefined) {
    return { group: '', title: id };
  }
  return assignmentLabel(board, position.assignmentId);
}

export function joinLabel(label: CallingLabel): string {
  return label.group === '' ? label.title : `${label.group} · ${label.title}`;
}

/** The calling a placement operation puts the dragged member into, or null for dugout operations. */
export function destinationLabel(board: Board, op: DropOp): CallingLabel | null {
  switch (op.kind) {
    case 'placeInPosition':
    case 'swap':
    case 'releaseOccupant':
      return positionLabel(board, op.request.to);
    case 'addToList':
      return assignmentLabel(board, op.request.assignmentId);
    case 'approvePlacement':
      return positionLabel(board, op.request.positionId);
    case 'moveToDugout':
    case 'addToDugout':
      return null;
  }
}

/** Lower-cases the first letter: "A member…" → "a member…". */
export function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
