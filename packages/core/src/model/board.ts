import { deepFreeze } from './freeze.ts';
import type { Result } from './result.ts';
import {
  ASSIGNMENT_ORIGINS,
  ASSIGNMENT_TYPES,
  BOARD_GROUP_KEYS,
  BOARD_KINDS,
  CALLING_GROUP_KINDS,
  CALLING_GROUP_PARENT_KINDS,
  LEADERSHIP_ROLES,
  OVERSEERS,
  OVERSIGHT_TARGET_KINDS,
  PRIESTS_QUORUM_KEY,
  type Approval,
  type Board,
  type BoardInput,
  type Oversight,
  type Ward,
} from './types.ts';
import {
  checkIdList,
  copyArray,
  ErrorCollector,
  hasKey,
  isBoolean,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegativeInteger,
  isObject,
  isOneOf,
  lookup,
  objectEntries,
  objectItems,
  recordEntries,
  trimmed,
} from './validate.ts';

// ---------------------------------------------------------------------------
// Copying: build fresh, normalized values (trimmed names) without validating.
// ---------------------------------------------------------------------------

function copyRecord<V extends object>(record: Readonly<Record<string, V>>, copy: (value: V) => V): Record<string, V> {
  if (!isObject(record)) {
    return record;
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, isObject(value) ? copy(value) : value]));
}

function copyRef<R extends object>(ref: R): R {
  return isObject(ref) ? { ...ref } : ref;
}

function copyBoard(input: BoardInput): Board {
  const placementsInput: unknown = input.placements;
  return {
    id: input.id,
    kind: input.kind,
    version: input.version,
    boardGroups: copyRecord(input.boardGroups, (g) => ({
      id: g.id,
      name: trimmed(g.name),
      order: g.order,
      visible: g.visible,
      key: g.key,
    })),
    callingGroups: copyRecord(input.callingGroups, (g) => ({
      id: g.id,
      name: trimmed(g.name),
      order: g.order,
      parent: copyRef(g.parent),
      kind: g.kind,
      key: g.key,
    })),
    assignments: copyRecord(input.assignments, (a) => ({
      id: a.id,
      groupId: a.groupId,
      title: trimmed(a.title),
      type: a.type,
      order: a.order,
      enabled: a.enabled,
      prominent: a.prominent,
      origin: a.origin,
      leadershipRole: a.leadershipRole,
      callingTagIds: copyArray(a.callingTagIds),
      preferredMemberTagIds: copyArray(a.preferredMemberTagIds),
    })),
    positions: copyRecord(input.positions, (p) => ({
      id: p.id,
      assignmentId: p.assignmentId,
      lineageId: p.lineageId,
      order: p.order,
    })),
    placements: isObject(placementsInput) ? { ...input.placements } : input.placements,
    oversight: copyArray(input.oversight, (o) => ({
      overseer: o.overseer,
      target: copyRef(o.target),
      fixed: o.fixed,
    })),
    dugoutInclusions: copyArray(input.dugoutInclusions),
    approvals: copyArray(input.approvals, (a) => ({
      memberId: a.memberId,
      positionId: a.positionId,
      approvedBy: a.approvedBy,
      approvedAt: a.approvedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function checkOrder(value: unknown, path: string, errors: ErrorCollector): void {
  if (!isNonNegativeInteger(value)) {
    errors.add('invalid_field', path, 'order must be a non-negative integer');
  }
}

function checkKeyMatches(id: unknown, key: string, path: string, errors: ErrorCollector): void {
  if (id !== key) {
    errors.add('invalid_field', `${path}.id`, `id must equal its record key ${key}`);
  }
}

/** Reports `duplicate_key` on each repeat of a non-null key. */
class KeyRegistry {
  readonly #seen = new Map<string, string>();
  readonly #errors: ErrorCollector;

  constructor(errors: ErrorCollector) {
    this.#errors = errors;
  }

  claim(key: string, owner: string, path: string): void {
    const existing = this.#seen.get(key);
    if (existing === undefined) {
      this.#seen.set(key, owner);
    } else {
      this.#errors.add('duplicate_key', path, `key "${key}" is already used by ${existing}`);
    }
  }
}

function validateBoardGroups(board: Board, errors: ErrorCollector): void {
  const keys = new KeyRegistry(errors);
  for (const [key, group] of recordEntries(board.boardGroups, 'boardGroups', errors)) {
    const path = `boardGroups.${key}`;
    checkKeyMatches(group.id, key, path, errors);
    if (!isNonEmptyString(group.name)) {
      errors.add('invalid_field', `${path}.name`, 'board group name must not be empty');
    }
    checkOrder(group.order, `${path}.order`, errors);
    if (!isBoolean(group.visible)) {
      errors.add('invalid_field', `${path}.visible`, 'visible must be a boolean');
    }
    if (group.key !== null) {
      if (isOneOf(BOARD_GROUP_KEYS, group.key)) {
        keys.claim(group.key, key, `${path}.key`);
      } else {
        errors.add('invalid_field', `${path}.key`, `board group key must be null or one of ${BOARD_GROUP_KEYS.join(', ')}`);
      }
    }
  }
}

function validateCallingGroups(board: Board, errors: ErrorCollector): void {
  const keys = new KeyRegistry(errors);
  for (const [key, group] of recordEntries(board.callingGroups, 'callingGroups', errors)) {
    const path = `callingGroups.${key}`;
    checkKeyMatches(group.id, key, path, errors);
    if (!isNonEmptyString(group.name)) {
      errors.add('invalid_field', `${path}.name`, 'calling group name must not be empty');
    }
    checkOrder(group.order, `${path}.order`, errors);
    if (!isOneOf(CALLING_GROUP_KINDS, group.kind)) {
      errors.add('invalid_field', `${path}.kind`, `kind must be one of ${CALLING_GROUP_KINDS.join(', ')}`);
    }
    if (group.key !== null) {
      if (isNonEmptyString(group.key)) {
        keys.claim(group.key, key, `${path}.key`);
      } else {
        errors.add('invalid_field', `${path}.key`, 'calling group key must be null or a non-empty string');
      }
    }
    const parent: unknown = group.parent;
    if (!isObject(parent) || !isOneOf(CALLING_GROUP_PARENT_KINDS, group.parent.kind)) {
      errors.add('invalid_field', `${path}.parent`, 'parent must be a board group or calling group reference');
    } else if (!hasKey(group.parent.kind === 'boardGroup' ? board.boardGroups : board.callingGroups, group.parent.id)) {
      errors.add('dangling_reference', `${path}.parent`, `parent ${group.parent.kind} ${group.parent.id} does not exist`);
    }
  }
}

/** Reports `group_cycle` on every calling group whose parent chain leads back to itself. Always terminates. */
function validateGroupCycles(board: Board, errors: ErrorCollector): void {
  const parentOf = new Map<string, string>();
  for (const [key, group] of objectEntries(board.callingGroups)) {
    const parent: unknown = group.parent;
    if (isObject(parent) && group.parent.kind === 'callingGroup' && hasKey(board.callingGroups, group.parent.id)) {
      parentOf.set(key, group.parent.id);
    }
  }
  for (const start of parentOf.keys()) {
    const visited = new Set<string>();
    let current = parentOf.get(start);
    while (current !== undefined && current !== start && !visited.has(current)) {
      visited.add(current);
      current = parentOf.get(current);
    }
    if (current === start) {
      errors.add('group_cycle', `callingGroups.${start}.parent`, `calling group ${start} is its own ancestor`);
    }
  }
}

function validateAssignments(board: Board, ward: Ward, errors: ErrorCollector): void {
  const tagExists = (id: string): boolean => hasKey(ward.tags, id);
  for (const [key, assignment] of recordEntries(board.assignments, 'assignments', errors)) {
    const path = `assignments.${key}`;
    checkKeyMatches(assignment.id, key, path, errors);
    if (!hasKey(board.callingGroups, assignment.groupId)) {
      errors.add('dangling_reference', `${path}.groupId`, `calling group ${String(assignment.groupId)} does not exist`);
    }
    if (!isNonEmptyString(assignment.title)) {
      errors.add('invalid_field', `${path}.title`, 'assignment title must not be empty');
    }
    if (!isOneOf(ASSIGNMENT_TYPES, assignment.type)) {
      errors.add('invalid_field', `${path}.type`, `type must be one of ${ASSIGNMENT_TYPES.join(', ')}`);
    }
    checkOrder(assignment.order, `${path}.order`, errors);
    if (!isBoolean(assignment.enabled)) {
      errors.add('invalid_field', `${path}.enabled`, 'enabled must be a boolean');
    }
    if (!isBoolean(assignment.prominent)) {
      errors.add('invalid_field', `${path}.prominent`, 'prominent must be a boolean');
    }
    if (!isOneOf(ASSIGNMENT_ORIGINS, assignment.origin)) {
      errors.add('invalid_field', `${path}.origin`, `origin must be one of ${ASSIGNMENT_ORIGINS.join(', ')}`);
    }
    if (assignment.leadershipRole !== null && !isOneOf(LEADERSHIP_ROLES, assignment.leadershipRole)) {
      errors.add('invalid_field', `${path}.leadershipRole`, `leadershipRole must be null or one of ${LEADERSHIP_ROLES.join(', ')}`);
    }
    checkIdList(assignment.callingTagIds, `${path}.callingTagIds`, errors, tagExists, 'tag');
    checkIdList(assignment.preferredMemberTagIds, `${path}.preferredMemberTagIds`, errors, tagExists, 'tag');
  }
}

function validatePositions(board: Board, errors: ErrorCollector): void {
  const lineages = new Map<string, string>();
  const positionCounts = new Map<string, number>();
  for (const [key, position] of recordEntries(board.positions, 'positions', errors)) {
    const path = `positions.${key}`;
    checkKeyMatches(position.id, key, path, errors);
    if (hasKey(board.assignments, position.assignmentId)) {
      positionCounts.set(position.assignmentId, (positionCounts.get(position.assignmentId) ?? 0) + 1);
    } else {
      errors.add('dangling_reference', `${path}.assignmentId`, `assignment ${String(position.assignmentId)} does not exist`);
    }
    if (!isNonEmptyString(position.lineageId)) {
      errors.add('invalid_field', `${path}.lineageId`, 'lineageId must be a non-empty string');
    } else {
      const existing = lineages.get(position.lineageId);
      if (existing === undefined) {
        lineages.set(position.lineageId, key);
      } else {
        errors.add('duplicate_lineage', `${path}.lineageId`, `lineage ${position.lineageId} is already used by position ${existing}`);
      }
    }
    checkOrder(position.order, `${path}.order`, errors);
  }

  for (const [key, assignment] of objectEntries(board.assignments)) {
    const count = positionCounts.get(key) ?? 0;
    if (assignment.type === 'single' && count !== 1) {
      errors.add('single_position_count', `assignments.${key}`, `single assignment has ${String(count)} positions; it must have exactly one`);
    }
  }
}

function validatePlacements(board: Board, ward: Ward, errors: ErrorCollector): void {
  const placements: unknown = board.placements;
  if (!isObject(placements)) {
    errors.add('invalid_field', 'placements', 'placements must be an object keyed by position id');
    return;
  }
  const listMembers = new Map<string, Set<string>>();
  for (const [positionKey, memberId] of Object.entries(board.placements)) {
    const path = `placements.${positionKey}`;
    if (!isNonEmptyString(memberId)) {
      errors.add('invalid_field', path, 'placement member id must be a non-empty string');
      continue;
    }
    if (!hasKey(ward.members, memberId)) {
      errors.add('dangling_reference', path, `member ${memberId} does not exist`);
    }
    const position = lookup(board.positions, positionKey);
    if (position === undefined) {
      errors.add('dangling_reference', path, `position ${positionKey} does not exist`);
      continue;
    }
    const assignment = lookup(board.assignments, position.assignmentId);
    if (assignment?.type !== 'list') {
      continue;
    }
    const seen = listMembers.get(assignment.id) ?? new Set<string>();
    listMembers.set(assignment.id, seen);
    if (seen.has(memberId)) {
      errors.add('list_duplicate_member', path, `member ${memberId} is already placed in list ${assignment.id}`);
    }
    seen.add(memberId);
  }
}

function isFixedBishopOfPriests(entry: Oversight, board: Board): boolean {
  if (entry.overseer !== 'bishop' || entry.target.kind !== 'callingGroup') {
    return false;
  }
  const group = lookup(board.callingGroups, entry.target.id);
  return group?.key === PRIESTS_QUORUM_KEY;
}

function targetsPriestsQuorum(entry: Oversight, board: Board): boolean {
  return entry.target.kind === 'callingGroup' && lookup(board.callingGroups, entry.target.id)?.key === PRIESTS_QUORUM_KEY;
}

/** Priests-quorum targets among oversight entries, ignoring malformed rows. */
function countPriestsQuorumTargets(board: Board): number {
  const oversight: unknown = board.oversight;
  if (!Array.isArray(oversight)) {
    return 0;
  }
  let count = 0;
  for (const entry of oversight) {
    if (!isObject(entry) || !('target' in entry)) {
      continue;
    }
    const target: unknown = entry.target;
    if (!isObject(target) || !('kind' in target) || !('id' in target)) {
      continue;
    }
    if (target.kind === 'callingGroup' && typeof target.id === 'string' && lookup(board.callingGroups, target.id)?.key === PRIESTS_QUORUM_KEY) {
      count += 1;
    }
  }
  return count;
}

function validateOversight(board: Board, errors: ErrorCollector): void {
  let fixedCount = 0;
  const seenTargets = new Set<string>();
  const priestsTargets = countPriestsQuorumTargets(board);
  for (const [index, entry] of objectItems(board.oversight, 'oversight', errors)) {
    const path = `oversight[${String(index)}]`;
    if (!isOneOf(OVERSEERS, entry.overseer)) {
      errors.add('invalid_field', `${path}.overseer`, `overseer must be one of ${OVERSEERS.join(', ')}`);
    }
    if (!isBoolean(entry.fixed)) {
      errors.add('invalid_field', `${path}.fixed`, 'fixed must be a boolean');
    }
    const target: unknown = entry.target;
    if (!isObject(target) || !isOneOf(OVERSIGHT_TARGET_KINDS, entry.target.kind)) {
      errors.add('invalid_field', `${path}.target`, 'target must be a board group or calling group reference');
      continue;
    }
    const exists =
      entry.target.kind === 'boardGroup'
        ? hasKey(board.boardGroups, entry.target.id)
        : hasKey(board.callingGroups, entry.target.id);
    if (!exists) {
      errors.add('dangling_reference', `${path}.target`, `${entry.target.kind} ${entry.target.id} does not exist`);
      continue;
    }
    if (entry.fixed) {
      if (!isFixedBishopOfPriests(entry, board)) {
        errors.add('fixed_oversight', path, 'only the bishop over the priests quorum may be fixed');
      } else if (fixedCount > 0) {
        errors.add('fixed_oversight', path, 'the fixed bishop oversight of the priests quorum may appear only once');
      } else {
        fixedCount += 1;
      }
    }
    if (targetsPriestsQuorum(entry, board)) {
      // A lone non-fixed bishop entry is the missing fixed entry, already reported at `oversight`.
      const loneBishopEntry = entry.overseer === 'bishop' && priestsTargets === 1;
      if (!entry.fixed && !loneBishopEntry) {
        errors.add('fixed_oversight', path, 'the priests quorum is overseen only by the fixed bishop entry');
      }
    } else {
      const key = `${entry.target.kind}\0${entry.target.id}`;
      if (seenTargets.has(key)) {
        errors.add('duplicate_oversight', path, 'each oversight target may have only one overseer');
      } else {
        seenTargets.add(key);
      }
    }
  }
  const hasPriestsQuorum = objectEntries(board.callingGroups).some(([, g]) => g.key === PRIESTS_QUORUM_KEY);
  if (hasPriestsQuorum && fixedCount === 0) {
    errors.add('fixed_oversight', 'oversight', 'the bishop must have fixed oversight of the priests quorum');
  }
}

function validateDugout(board: Board, ward: Ward, errors: ErrorCollector): void {
  checkIdList(board.dugoutInclusions, 'dugoutInclusions', errors, (id) => hasKey(ward.members, id), 'member');
}

function validateApprovals(board: Board, ward: Ward, errors: ErrorCollector): void {
  for (const [index, approval] of objectItems<Approval>(board.approvals, 'approvals', errors)) {
    const path = `approvals[${String(index)}]`;
    const memberKnown = hasKey(ward.members, approval.memberId);
    const positionKnown = hasKey(board.positions, approval.positionId);
    if (!memberKnown) {
      errors.add('dangling_reference', `${path}.memberId`, `member ${String(approval.memberId)} does not exist`);
    }
    if (!positionKnown) {
      errors.add('dangling_reference', `${path}.positionId`, `position ${String(approval.positionId)} does not exist`);
    }
    if (!isNonEmptyString(approval.approvedBy)) {
      errors.add('invalid_field', `${path}.approvedBy`, 'approvedBy must be a non-empty user id');
    }
    if (!isIsoTimestamp(approval.approvedAt)) {
      errors.add('invalid_field', `${path}.approvedAt`, 'approvedAt must be an ISO timestamp');
    }
    const placed: unknown = hasKey(board.placements, approval.positionId)
      ? board.placements[approval.positionId]
      : undefined;
    if (memberKnown && positionKnown && placed !== approval.memberId) {
      errors.add('approval_not_placed', path, `member ${approval.memberId} is not placed in position ${approval.positionId}`);
    }
  }
}

/**
 * Validates a board (structure, placements, oversight, dugout inclusions and
 * approvals) against ward-wide data and appends every error to `errors`.
 * Returns the normalized copy, which is only meaningful when no error was added.
 */
export function validateBoard(input: BoardInput, ward: Ward, errors: ErrorCollector): Board {
  const board = copyBoard(input);

  if (!isNonEmptyString(board.id)) {
    errors.add('invalid_field', 'id', 'board id must be a non-empty string');
  }
  if (!isOneOf(BOARD_KINDS, board.kind)) {
    errors.add('invalid_field', 'kind', `kind must be one of ${BOARD_KINDS.join(', ')}`);
  }
  if (!isNonNegativeInteger(board.version)) {
    errors.add('invalid_field', 'version', 'version must be a non-negative integer');
  }
  validateBoardGroups(board, errors);
  validateCallingGroups(board, errors);
  validateGroupCycles(board, errors);
  validateAssignments(board, ward, errors);
  validatePositions(board, errors);
  validatePlacements(board, ward, errors);
  validateOversight(board, errors);
  validateDugout(board, ward, errors);
  validateApprovals(board, ward, errors);
  return board;
}

/**
 * Validates a board against ward-wide data and returns a deeply frozen,
 * normalized copy. Collects every error rather than stopping at the first.
 */
export function createBoard(input: BoardInput, ward: Ward): Result<Board> {
  const errors = new ErrorCollector();
  const board = validateBoard(input, ward, errors);
  if (errors.errors.length > 0) {
    return { ok: false, errors: errors.errors };
  }
  return { ok: true, value: deepFreeze(board) };
}
