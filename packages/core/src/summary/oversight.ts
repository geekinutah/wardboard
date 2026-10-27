import type { CallingGroupId } from '../model/ids.ts';
import type { Board, CallingGroup, Overseer, Oversight, OversightTarget } from '../model/types.ts';

/*
 * Who oversees a group (SPEC §4). The group's own entry wins. Otherwise the
 * nearest ancestor entry in the calling-group parent chain, then the root
 * board group. With no entry anywhere, the bishop.
 */

function sameTarget(left: OversightTarget, right: OversightTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function entryFor(board: Board, target: OversightTarget): Oversight | undefined {
  return board.oversight.find((entry) => sameTarget(entry.target, target));
}

function groupExists(board: Board, target: OversightTarget): boolean {
  if (target.kind === 'boardGroup') {
    return Object.hasOwn(board.boardGroups, target.id);
  }
  return Object.hasOwn(board.callingGroups, target.id);
}

function ancestorOverseer(board: Board, startId: CallingGroupId): Overseer {
  const start = board.callingGroups[startId];
  if (start === undefined) {
    throw new TypeError(`calling group ${startId} does not exist`);
  }
  const seen = new Set<string>([startId]);
  let current: CallingGroup = start;
  const limit = Object.keys(board.callingGroups).length + 1;
  for (let step = 0; step < limit; step += 1) {
    const parent = current.parent;
    if (parent.kind === 'boardGroup') {
      return entryFor(board, { kind: 'boardGroup', id: parent.id })?.overseer ?? 'bishop';
    }
    if (seen.has(parent.id)) {
      throw new TypeError(`calling group ${startId} is its own ancestor`);
    }
    seen.add(parent.id);
    const next: CallingGroup | undefined = board.callingGroups[parent.id];
    if (next === undefined) {
      throw new TypeError(`calling group ${parent.id} does not exist`);
    }
    const entry = entryFor(board, { kind: 'callingGroup', id: next.id });
    if (entry !== undefined) {
      return entry.overseer;
    }
    current = next;
  }
  throw new TypeError(`calling group ${startId} is its own ancestor`);
}

/**
 * The overseer of `target`. Throws `TypeError` when that group does not exist.
 */
export function overseerOf(board: Board, target: OversightTarget): Overseer {
  if (!groupExists(board, target)) {
    throw new TypeError(`oversight target ${target.kind} ${target.id} does not exist`);
  }
  const direct = entryFor(board, target);
  if (direct !== undefined) {
    return direct.overseer;
  }
  if (target.kind === 'boardGroup') {
    return 'bishop';
  }
  return ancestorOverseer(board, target.id);
}
