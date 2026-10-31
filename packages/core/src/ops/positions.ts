import {
  assignmentId,
  callingGroupId,
  lineageId,
  positionId,
  type AssignmentId,
  type BoardGroupId,
  type CallingGroupId,
  type MemberId,
  type PositionId,
} from '../model/ids.ts';
import {
  CALLING_GENDER_RULES,
  CALLING_GROUP_KINDS,
  type AssignmentType,
  type Board,
  type BoardGroup,
  type CallingAssignment,
  type CallingGenderRule,
  type CallingGroup,
  type CallingGroupKind,
  type CallingGroupParent,
  type Position,
} from '../model/types.ts';
import { isOneOf } from '../model/validate.ts';
import {
  checkEditable,
  dropStaleApprovals,
  finalizeBoard,
  INVALID_OPERATION,
  NOT_FOUND,
  operationError,
  operationOk,
  type OperationContext,
  type OperationResult,
  type SharedOperationErrorCode,
} from './types.ts';
import { applyPresidencyRelease } from './presidency.ts';

/*
 * Structural edits for one proposal board (SPEC §4, §5, §7). Removing an
 * occupied position releases that placement and appends explicit dugout
 * inclusion. `removePosition` and `removeAssignment` apply the presidency
 * release rule before stale approvals are dropped.
 *
 * Fresh ids come from `ctx.ids` in the order documented on each operation.
 * Names and titles are trimmed; empty after trimming is `invalid_name`.
 */

/** Error codes specific to structural edits, in addition to the shared codes. */
export const POSITION_ERROR_CODES = [
  /** Name or title is empty after trimming. */
  'invalid_name',
  /** The operation does not apply to this assignment type. */
  'wrong_assignment_type',
  /** `addListPosition` was given a disabled list. */
  'assignment_disabled',
] as const;
export type PositionSpecificErrorCode = (typeof POSITION_ERROR_CODES)[number];
export type PositionErrorCode = SharedOperationErrorCode | PositionSpecificErrorCode;

const MAX_LIST_POSITIONS = 50;

export interface AddCallingGroupRequest {
  readonly parent: CallingGroupParent;
  readonly name: string;
  /** One of `CALLING_GROUP_KINDS`; anything else is `invalid_operation`. */
  readonly kind: string;
}

export interface RenameGroupRequest {
  readonly target: CallingGroupParent;
  readonly name: string;
}

export interface SetBoardGroupVisibleRequest {
  readonly boardGroupId: BoardGroupId;
  readonly visible: boolean;
}

export interface MoveGroupRequest {
  readonly target: CallingGroupParent;
  /** 0-based index among the target's siblings. */
  readonly toIndex: number;
}

export interface AddAssignmentRequest {
  readonly groupId: CallingGroupId;
  readonly title: string;
  readonly type: AssignmentType;
  /** `1` for a single. An integer `0..50` for a list. */
  readonly positionCount: number;
  /** Omitted assignments stay unrestricted. Invalid values are `invalid_operation`. */
  readonly genderRule?: CallingGenderRule;
}

export interface AddListPositionRequest {
  readonly assignmentId: AssignmentId;
}

export interface RemovePositionRequest {
  readonly positionId: PositionId;
}

export interface RemoveAssignmentRequest {
  readonly assignmentId: AssignmentId;
}

function blocked(board: Board): OperationResult<PositionErrorCode> | null {
  const editable = checkEditable(board);
  if (editable === null) {
    return null;
  }
  return operationError(editable.code, editable.message);
}

function commit(ctx: OperationContext, next: Board): OperationResult<PositionErrorCode> {
  return operationOk(finalizeBoard(dropStaleApprovals(next), ctx.ward));
}

function commitWithPresidencyRelease(before: Board, ctx: OperationContext, next: Board): OperationResult<PositionErrorCode> {
  return operationOk(finalizeBoard(dropStaleApprovals(applyPresidencyRelease(before, next)), ctx.ward));
}

function isCallingGroupKind(kind: string): kind is CallingGroupKind {
  for (const allowed of CALLING_GROUP_KINDS) {
    if (allowed === kind) {
      return true;
    }
  }
  return false;
}

function findBoardGroup(board: Board, id: BoardGroupId): BoardGroup | undefined {
  return Object.hasOwn(board.boardGroups, id) ? board.boardGroups[id] : undefined;
}

function findCallingGroup(board: Board, id: CallingGroupId): CallingGroup | undefined {
  return Object.hasOwn(board.callingGroups, id) ? board.callingGroups[id] : undefined;
}

function findAssignment(board: Board, id: AssignmentId): CallingAssignment | undefined {
  return Object.hasOwn(board.assignments, id) ? board.assignments[id] : undefined;
}

function findPosition(board: Board, id: PositionId): Position | undefined {
  return Object.hasOwn(board.positions, id) ? board.positions[id] : undefined;
}

function occupantOf(board: Board, id: PositionId): MemberId | undefined {
  return Object.hasOwn(board.placements, id) ? board.placements[id] : undefined;
}

function parentExists(board: Board, parent: CallingGroupParent): boolean {
  switch (parent.kind) {
    case 'boardGroup':
      return findBoardGroup(board, parent.id) !== undefined;
    case 'callingGroup':
      return findCallingGroup(board, parent.id) !== undefined;
  }
}

function sameParent(left: CallingGroupParent, right: CallingGroupParent): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.id === right.id;
}

function copyParent(parent: CallingGroupParent): CallingGroupParent {
  switch (parent.kind) {
    case 'boardGroup':
      return { kind: 'boardGroup', id: parent.id };
    case 'callingGroup':
      return { kind: 'callingGroup', id: parent.id };
  }
}

function compareOrderThenId(
  left: { readonly order: number; readonly id: string },
  right: { readonly order: number; readonly id: string },
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.id.localeCompare(right.id);
}

function callingSiblings(board: Board, parent: CallingGroupParent): CallingGroup[] {
  return Object.values(board.callingGroups)
    .filter((group) => sameParent(group.parent, parent))
    .sort(compareOrderThenId);
}

function positionsInAssignment(board: Board, id: AssignmentId): Position[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === id)
    .sort(compareOrderThenId);
}

/** `max(order) + 1`, or 0 when there are no orders. */
function nextOrder(orders: readonly number[]): number {
  let next = 0;
  for (const order of orders) {
    const candidate = order + 1;
    if (candidate > next) {
      next = candidate;
    }
  }
  return next;
}

function allocator(ctx: OperationContext): (label: string, taken: (id: string) => boolean) => string {
  const used = new Set<string>();
  return (label, taken) => {
    const id = ctx.ids();
    if (used.has(id) || taken(id)) {
      throw new Error(`id generator returned existing ${label} id ${id}`);
    }
    used.add(id);
    return id;
  };
}

function positionCountMessage(type: AssignmentType, count: number): string | null {
  if (type === 'single') {
    return count === 1 ? null : 'a single assignment must have exactly one position';
  }
  if (Number.isInteger(count) && count >= 0 && count <= MAX_LIST_POSITIONS) {
    return null;
  }
  return `a list position count must be an integer from 0 to ${String(MAX_LIST_POSITIONS)}`;
}

function indexMessage(toIndex: number, count: number): string | null {
  if (Number.isInteger(toIndex) && toIndex >= 0 && toIndex < count) {
    return null;
  }
  return `index ${String(toIndex)} is outside 0..${String(count - 1)}`;
}

function moveToIndex<T extends { readonly id: string }>(sorted: readonly T[], id: string, toIndex: number): T[] {
  const fromIndex = sorted.findIndex((item) => item.id === id);
  if (fromIndex < 0) {
    throw new Error(`sibling ${id} is not in its ordered set`);
  }
  const next = sorted.slice();
  const moving = next[fromIndex];
  if (moving === undefined) {
    throw new Error(`sibling ${id} is not in its ordered set`);
  }
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moving);
  return next;
}

function orderNumbers(ordered: readonly { readonly id: string }[]): Map<string, number> {
  const orders = new Map<string, number>();
  for (const [index, item] of ordered.entries()) {
    orders.set(item.id, index);
  }
  return orders;
}

function renumberBoardGroups(board: Board, ordered: readonly BoardGroup[]): Board['boardGroups'] {
  const orders = orderNumbers(ordered);
  const next: Record<BoardGroupId, BoardGroup> = {};
  for (const group of Object.values(board.boardGroups)) {
    const order = orders.get(group.id);
    next[group.id] = order === undefined || order === group.order ? group : { ...group, order };
  }
  return next;
}

function renumberCallingGroups(board: Board, ordered: readonly CallingGroup[]): Board['callingGroups'] {
  const orders = orderNumbers(ordered);
  const next: Record<CallingGroupId, CallingGroup> = {};
  for (const group of Object.values(board.callingGroups)) {
    const order = orders.get(group.id);
    next[group.id] = order === undefined || order === group.order ? group : { ...group, order };
  }
  return next;
}

function withoutPositions(board: Board, removed: ReadonlySet<string>): Board['positions'] {
  const next: Record<PositionId, Position> = {};
  for (const position of Object.values(board.positions)) {
    if (!removed.has(position.id)) {
      next[position.id] = position;
    }
  }
  return next;
}

function withoutPlacements(board: Board, removed: ReadonlySet<string>): Board['placements'] {
  const next: Record<PositionId, MemberId> = {};
  for (const [key, member] of Object.entries(board.placements)) {
    if (!removed.has(key)) {
      next[positionId(key)] = member;
    }
  }
  return next;
}

function withoutAssignments(board: Board, removed: ReadonlySet<string>): Board['assignments'] {
  const next: Record<AssignmentId, CallingAssignment> = {};
  for (const assignment of Object.values(board.assignments)) {
    if (!removed.has(assignment.id)) {
      next[assignment.id] = assignment;
    }
  }
  return next;
}

function appendInclusions(existing: readonly MemberId[], members: readonly MemberId[]): readonly MemberId[] {
  const seen = new Set<string>(existing);
  const added: MemberId[] = [];
  for (const member of members) {
    if (!seen.has(member)) {
      seen.add(member);
      added.push(member);
    }
  }
  return added.length === 0 ? existing : [...existing, ...added];
}

/**
 * Appends a calling group under `parent`. Id: one group id. `order` is one past
 * the max sibling order (0 when there are none). `key` is null.
 *
 * Errors: `board_not_editable`; `not_found` (parent); `invalid_name`; `invalid_operation` (kind).
 */
export function addCallingGroup(
  board: Board,
  ctx: OperationContext,
  request: AddCallingGroupRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  if (!parentExists(board, request.parent)) {
    return operationError(NOT_FOUND, `parent ${request.parent.kind} ${request.parent.id} does not exist`);
  }
  const name = request.name.trim();
  if (name === '') {
    return operationError('invalid_name', 'name must not be empty');
  }
  if (!isCallingGroupKind(request.kind)) {
    return operationError(INVALID_OPERATION, `kind ${request.kind} is not a calling group kind`);
  }
  const take = allocator(ctx);
  const id = callingGroupId(take('calling group', (candidate) => Object.hasOwn(board.callingGroups, candidate)));
  const group: CallingGroup = {
    id,
    name,
    order: nextOrder(callingSiblings(board, request.parent).map((sibling) => sibling.order)),
    parent: copyParent(request.parent),
    kind: request.kind,
    key: null,
  };
  return commit(ctx, { ...board, callingGroups: { ...board.callingGroups, [id]: group } });
}

/**
 * Changes a board group's or calling group's name. Keys are left untouched.
 *
 * Errors: `board_not_editable`; `not_found`; `invalid_name`.
 */
export function renameGroup(
  board: Board,
  ctx: OperationContext,
  request: RenameGroupRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const name = nonEmptyName(request.name);
  switch (request.target.kind) {
    case 'boardGroup': {
      const group = findBoardGroup(board, request.target.id);
      if (group === undefined) {
        return operationError(NOT_FOUND, `board group ${request.target.id} does not exist`);
      }
      if (name === null) {
        return operationError('invalid_name', 'name must not be empty');
      }
      return commit(ctx, { ...board, boardGroups: { ...board.boardGroups, [group.id]: { ...group, name } } });
    }
    case 'callingGroup': {
      const group = findCallingGroup(board, request.target.id);
      if (group === undefined) {
        return operationError(NOT_FOUND, `calling group ${request.target.id} does not exist`);
      }
      if (name === null) {
        return operationError('invalid_name', 'name must not be empty');
      }
      return commit(ctx, { ...board, callingGroups: { ...board.callingGroups, [group.id]: { ...group, name } } });
    }
  }
}

function nonEmptyName(value: string): string | null {
  const name = value.trim();
  return name === '' ? null : name;
}

/**
 * Shows or hides a board group. Hiding does not release anyone or remove positions.
 *
 * Errors: `board_not_editable`; `not_found`.
 */
export function setBoardGroupVisible(
  board: Board,
  ctx: OperationContext,
  request: SetBoardGroupVisibleRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const group = findBoardGroup(board, request.boardGroupId);
  if (group === undefined) {
    return operationError(NOT_FOUND, `board group ${request.boardGroupId} does not exist`);
  }
  return commit(ctx, {
    ...board,
    boardGroups: { ...board.boardGroups, [group.id]: { ...group, visible: request.visible } },
  });
}

/**
 * Moves a group among its siblings and renumbers that sibling set `0..n-1`.
 * Board groups are siblings of each other. Calling groups are siblings when they
 * share a parent. Nothing outside that set changes.
 *
 * Errors: `board_not_editable`; `not_found`; `invalid_operation` (index).
 */
export function moveGroup(board: Board, ctx: OperationContext, request: MoveGroupRequest): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  switch (request.target.kind) {
    case 'boardGroup':
      return moveBoardGroup(board, ctx, request.target.id, request.toIndex);
    case 'callingGroup':
      return moveCallingGroup(board, ctx, request.target.id, request.toIndex);
  }
}

function moveBoardGroup(
  board: Board,
  ctx: OperationContext,
  id: BoardGroupId,
  toIndex: number,
): OperationResult<PositionErrorCode> {
  const group = findBoardGroup(board, id);
  if (group === undefined) {
    return operationError(NOT_FOUND, `board group ${id} does not exist`);
  }
  const siblings = Object.values(board.boardGroups).sort(compareOrderThenId);
  const message = indexMessage(toIndex, siblings.length);
  if (message !== null) {
    return operationError(INVALID_OPERATION, message);
  }
  return commit(ctx, { ...board, boardGroups: renumberBoardGroups(board, moveToIndex(siblings, group.id, toIndex)) });
}

function moveCallingGroup(
  board: Board,
  ctx: OperationContext,
  id: CallingGroupId,
  toIndex: number,
): OperationResult<PositionErrorCode> {
  const group = findCallingGroup(board, id);
  if (group === undefined) {
    return operationError(NOT_FOUND, `calling group ${id} does not exist`);
  }
  const siblings = callingSiblings(board, group.parent);
  const message = indexMessage(toIndex, siblings.length);
  if (message !== null) {
    return operationError(INVALID_OPERATION, message);
  }
  return commit(ctx, { ...board, callingGroups: renumberCallingGroups(board, moveToIndex(siblings, group.id, toIndex)) });
}

/**
 * Adds a custom assignment and its vacant positions.
 * Ids: assignment id, then for each position its position id and lineage id.
 * `order` is one past the max assignment order in the group (0 when there are none).
 * Positions are ordered `0..n-1`. Duplicate titles are allowed.
 *
 * Errors: `board_not_editable`; `not_found` (group); `invalid_name`; `invalid_operation` (count).
 */
export function addAssignment(
  board: Board,
  ctx: OperationContext,
  request: AddAssignmentRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const group = findCallingGroup(board, request.groupId);
  if (group === undefined) {
    return operationError(NOT_FOUND, `calling group ${request.groupId} does not exist`);
  }
  const title = request.title.trim();
  if (title === '') {
    return operationError('invalid_name', 'title must not be empty');
  }
  const countMessage = positionCountMessage(request.type, request.positionCount);
  if (countMessage !== null) {
    return operationError(INVALID_OPERATION, countMessage);
  }
  let genderRule: CallingGenderRule | undefined;
  if (request.genderRule !== undefined) {
    const supplied: unknown = request.genderRule;
    if (!isOneOf(CALLING_GENDER_RULES, supplied)) {
      return operationError(INVALID_OPERATION, 'genderRule must be M, F, any, or presidency_aligned');
    }
    genderRule = supplied;
  }
  const take = allocator(ctx);
  const id = assignmentId(take('assignment', (candidate) => Object.hasOwn(board.assignments, candidate)));
  const positions: Record<PositionId, Position> = { ...board.positions };
  const lineages = new Set<string>(Object.values(board.positions).map((position) => position.lineageId));
  for (let order = 0; order < request.positionCount; order += 1) {
    const position = positionId(take('position', (candidate) => Object.hasOwn(positions, candidate)));
    const lineage = lineageId(take('lineage', (candidate) => lineages.has(candidate)));
    lineages.add(lineage);
    positions[position] = { id: position, assignmentId: id, lineageId: lineage, order };
  }
  const assignment: CallingAssignment = {
    id,
    groupId: group.id,
    title,
    type: request.type,
    order: nextOrder(
      Object.values(board.assignments)
        .filter((item) => item.groupId === group.id)
        .map((item) => item.order),
    ),
    enabled: true,
    prominent: false,
    origin: 'custom',
    ...(genderRule !== undefined ? { genderRule } : {}),
    leadershipRole: null,
    callingTagIds: [],
    preferredMemberTagIds: [],
  };
  return commit(ctx, {
    ...board,
    assignments: { ...board.assignments, [id]: assignment },
    positions,
  });
}

/**
 * Appends one vacant position to an enabled list ("+1").
 * Ids: position id, then lineage id. `order` is one past the max (0 when the list is empty).
 *
 * Errors: `board_not_editable`; `not_found`; `wrong_assignment_type`; `assignment_disabled`.
 */
export function addListPosition(
  board: Board,
  ctx: OperationContext,
  request: AddListPositionRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const assignment = findAssignment(board, request.assignmentId);
  if (assignment === undefined) {
    return operationError(NOT_FOUND, `assignment ${request.assignmentId} does not exist`);
  }
  if (assignment.type !== 'list') {
    return operationError('wrong_assignment_type', `assignment ${assignment.id} is a single; use addAssignment`);
  }
  if (!assignment.enabled) {
    return operationError('assignment_disabled', `assignment ${assignment.id} is disabled`);
  }
  const take = allocator(ctx);
  const positions: Record<PositionId, Position> = { ...board.positions };
  const id = positionId(take('position', (candidate) => Object.hasOwn(positions, candidate)));
  const lineages = new Set<string>(Object.values(positions).map((position) => position.lineageId));
  const lineage = lineageId(take('lineage', (candidate) => lineages.has(candidate)));
  positions[id] = {
    id,
    assignmentId: assignment.id,
    lineageId: lineage,
    order: nextOrder(positionsInAssignment(board, assignment.id).map((position) => position.order)),
  };
  return commit(ctx, { ...board, positions });
}

/**
 * Deletes a list position. A vacant removal only reduces staffing need.
 * An occupied removal releases that placement and appends the occupant to
 * `dugoutInclusions` (never duplicated), even when they keep other callings.
 * Other positions' orders are unchanged. Allowed on a disabled list, including
 * one that is left with zero positions. A single's position is refused.
 *
 * Errors: `board_not_editable`; `not_found`; `wrong_assignment_type`.
 */
export function removePosition(
  board: Board,
  ctx: OperationContext,
  request: RemovePositionRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const position = findPosition(board, request.positionId);
  if (position === undefined) {
    return operationError(NOT_FOUND, `position ${request.positionId} does not exist`);
  }
  const assignment = findAssignment(board, position.assignmentId);
  if (assignment === undefined) {
    throw new Error(`position ${position.id} references missing assignment ${position.assignmentId}`);
  }
  if (assignment.type !== 'list') {
    return operationError(
      'wrong_assignment_type',
      `position ${position.id} belongs to single ${assignment.id}; use removeAssignment`,
    );
  }
  const removed = new Set<string>([position.id]);
  const occupant = occupantOf(board, position.id);
  return commitWithPresidencyRelease(board, ctx, {
    ...board,
    positions: withoutPositions(board, removed),
    placements: withoutPlacements(board, removed),
    dugoutInclusions: occupant === undefined ? board.dugoutInclusions : appendInclusions(board.dugoutInclusions, [occupant]),
  });
}

/**
 * Deletes an assignment and every position it owns. Each occupant is released
 * from those positions and explicitly included in the dugout once, in position
 * order, keeping other callings. Removing a president assignment also vacates
 * that presidency's counselors and secretary without an explicit inclusion.
 * Approvals for the deleted positions are dropped.
 *
 * Errors: `board_not_editable`; `not_found`.
 */
export function removeAssignment(
  board: Board,
  ctx: OperationContext,
  request: RemoveAssignmentRequest,
): OperationResult<PositionErrorCode> {
  const refused = blocked(board);
  if (refused !== null) {
    return refused;
  }
  const assignment = findAssignment(board, request.assignmentId);
  if (assignment === undefined) {
    return operationError(NOT_FOUND, `assignment ${request.assignmentId} does not exist`);
  }
  const positions = positionsInAssignment(board, assignment.id);
  const released: MemberId[] = [];
  for (const position of positions) {
    const occupant = occupantOf(board, position.id);
    if (occupant !== undefined) {
      released.push(occupant);
    }
  }
  const removed = new Set(positions.map((position) => position.id));
  return commitWithPresidencyRelease(board, ctx, {
    ...board,
    assignments: withoutAssignments(board, new Set([assignment.id])),
    positions: withoutPositions(board, removed),
    placements: withoutPlacements(board, removed),
    dugoutInclusions: appendInclusions(board.dugoutInclusions, released),
  });
}
