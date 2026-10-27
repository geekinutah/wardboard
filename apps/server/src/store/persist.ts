import type { DatabaseSync, SQLOutputValue, StatementResultingChanges } from 'node:sqlite';
import {
  ASSIGNMENT_ORIGINS,
  ASSIGNMENT_TYPES,
  BOARD_GROUP_KEYS,
  BOARD_KINDS,
  CALLING_GROUP_KINDS,
  LEADERSHIP_ROLES,
  MEMBER_CATEGORIES,
  OVERSEERS,
  PROPOSAL_STATUSES,
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
  tagId,
  userId,
  type AssignmentId,
  type Board,
  type BoardGroup,
  type BoardGroupId,
  type BoardKind,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type Member,
  type MemberId,
  type Oversight,
  type Position,
  type PositionId,
  type Proposal,
  type ProposalAcceptance,
  type ProposalStatus,
  type Result,
  type Tag,
  type TagId,
  type Ward,
} from '@wardboard/core';
import type { ProposalSummary } from './types.ts';

// Board-owned row ids are `<boardId>:<coreId>` because 001 primary keys are global
// and a proposal reuses its baseline's core ids. Lineage, member, tag, and board
// ids stay unprefixed. Oversight stores `overseer` and leaves `position_id` null.
// Callers of the write functions hold the immediate transaction.

type SqlRow = Record<string, SQLOutputValue>;

export class AlreadyInitializedError extends Error {
  constructor() {
    super('a current board already exists');
    this.name = 'AlreadyInitializedError';
  }
}

export type BoardMeta = {
  id: string;
  kind: BoardKind;
  version: number;
  status: ProposalStatus | null;
  proposalId: string | null;
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'write failed';
}

export function withImmediateTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    const value = body();
    db.exec('COMMIT');
    return value;
  } catch (error: unknown) {
    rollBack(db, error);
    throw error;
  }
}

export function findCurrentId(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT id FROM boards WHERE kind = 'current'").get();
  if (row === undefined) return null;
  return text(row, 'id');
}

export function readBoardMeta(db: DatabaseSync, id: string): BoardMeta | null {
  const row = db
    .prepare('SELECT id, kind, version, status, proposal_id FROM boards WHERE id = ?')
    .get(id);
  if (row === undefined) return null;
  const status = textOrNull(row, 'status');
  return {
    id: text(row, 'id'),
    kind: oneOf(BOARD_KINDS, text(row, 'kind'), 'board kind'),
    version: integer(row, 'version'),
    status: status === null ? null : oneOf(PROPOSAL_STATUSES, status, 'proposal status'),
    proposalId: textOrNull(row, 'proposal_id'),
  };
}

export function readWard(db: DatabaseSync): Ward {
  const tags: Record<TagId, Tag> = {};
  for (const row of db.prepare('SELECT id, name FROM tags').all()) {
    const id = tagId(text(row, 'id'));
    tags[id] = { id, name: text(row, 'name') };
  }

  const tagIdsByMember = new Map<string, TagId[]>();
  for (const row of db
    .prepare('SELECT member_id, tag_id FROM member_tags ORDER BY member_id, sort_order, tag_id')
    .all()) {
    const member = text(row, 'member_id');
    const tagIds = tagIdsByMember.get(member) ?? [];
    tagIds.push(tagId(text(row, 'tag_id')));
    tagIdsByMember.set(member, tagIds);
  }

  const callingsByMember = new Map<string, { unit: string; title: string }[]>();
  for (const row of db
    .prepare(
      'SELECT member_id, unit, title FROM external_callings ORDER BY member_id, sort_order, id',
    )
    .all()) {
    const member = text(row, 'member_id');
    const callings = callingsByMember.get(member) ?? [];
    callings.push({ unit: text(row, 'unit'), title: text(row, 'title') });
    callingsByMember.set(member, callings);
  }

  const members: Record<MemberId, Member> = {};
  for (const row of db
    .prepare(
      `SELECT id, name, photo_ref, category, note, needs_approval, removed_date
       FROM members`,
    )
    .all()) {
    const id = memberId(text(row, 'id'));
    members[id] = {
      id,
      name: text(row, 'name'),
      category: oneOf(MEMBER_CATEGORIES, text(row, 'category'), 'member category'),
      photoRef: textOrNull(row, 'photo_ref'),
      note: textOrNull(row, 'note'),
      tagIds: tagIdsByMember.get(id) ?? [],
      needsApproval: flag(row, 'needs_approval'),
      removedDate: textOrNull(row, 'removed_date'),
      externalCallings: callingsByMember.get(id) ?? [],
    };
  }

  return must(createWard({ members, tags }), 'ward');
}

export function readBoard(db: DatabaseSync, id: string, ward: Ward): Board | null {
  const row = db.prepare('SELECT id, kind, version FROM boards WHERE id = ?').get(id);
  if (row === undefined) return null;
  const board: Board = {
    id: boardId(text(row, 'id')),
    kind: oneOf(BOARD_KINDS, text(row, 'kind'), 'board kind'),
    version: integer(row, 'version'),
    boardGroups: readBoardGroups(db, id),
    callingGroups: readCallingGroups(db, id),
    assignments: readAssignments(db, id),
    positions: readPositions(db, id),
    placements: readPlacements(db, id),
    oversight: readOversight(db, id),
    dugoutInclusions: readDugout(db, id),
    approvals: readApprovals(db, id),
  };
  return must(createBoard(board, ward), `board ${id}`);
}

export function readProposal(db: DatabaseSync, id: string): Proposal | null {
  const row = db
    .prepare(
      `SELECT id, proposal_id, name, status, rationale, tab_order, baseline_board_id,
              accepted_by, accepted_at, accepted_summary, created_at, updated_at
       FROM boards WHERE proposal_id = ?`,
    )
    .get(id);
  if (row === undefined) return null;
  const ward = readWard(db);
  const baselineId = text(row, 'baseline_board_id');
  const workingId = text(row, 'id');
  const baseline = readBoard(db, baselineId, ward);
  const board = readBoard(db, workingId, ward);
  if (baseline === null || board === null) {
    throw new Error(`proposal ${id} is missing a board`);
  }
  const status = oneOf(PROPOSAL_STATUSES, text(row, 'status'), 'proposal status');
  return must(
    createProposal(
      {
        id: proposalId(text(row, 'proposal_id')),
        name: text(row, 'name'),
        rationale: textOrNull(row, 'rationale'),
        status,
        accepted: acceptance(row, status, id),
        baseline,
        board,
        tabOrder: integer(row, 'tab_order'),
        createdAt: text(row, 'created_at'),
        updatedAt: text(row, 'updated_at'),
      },
      ward,
    ),
    `proposal ${id}`,
  );
}

export function readCurrentRecord(
  db: DatabaseSync,
): { board: Board; importVersion: string; importedAt: string } | null {
  const row = db
    .prepare("SELECT id, import_version, created_at FROM boards WHERE kind = 'current'")
    .get();
  if (row === undefined) return null;
  const id = text(row, 'id');
  const importVersion = textOrNull(row, 'import_version');
  if (importVersion === null) {
    throw new Error('current board is missing import_version');
  }
  const board = readBoard(db, id, readWard(db));
  if (board === null) {
    throw new Error('current board row is missing');
  }
  return { board, importVersion, importedAt: text(row, 'created_at') };
}

export function listProposalSummaries(db: DatabaseSync): ProposalSummary[] {
  const rows = db
    .prepare(
      `SELECT proposal_id, name, status, tab_order, id, version, updated_at
       FROM boards
       WHERE proposal_id IS NOT NULL
       ORDER BY tab_order, proposal_id`,
    )
    .all();
  return rows.map((row) => {
    const id = text(row, 'proposal_id');
    if (row['tab_order'] === null || row['tab_order'] === undefined) {
      throw new Error(`proposal ${id} is missing tab_order`);
    }
    return {
      id: proposalId(id),
      name: text(row, 'name'),
      status: oneOf(PROPOSAL_STATUSES, text(row, 'status'), 'proposal status'),
      tabOrder: integer(row, 'tab_order'),
      boardId: boardId(text(row, 'id')),
      version: integer(row, 'version'),
      updatedAt: text(row, 'updated_at'),
    };
  });
}

export function nextTabOrder(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT MAX(tab_order) AS n FROM boards WHERE proposal_id IS NOT NULL')
    .get();
  if (row === undefined) return 0;
  const value = row['n'];
  if (value === null || value === undefined) return 0;
  return integer({ n: value }, 'n') + 1;
}

export function writeInitialization(
  db: DatabaseSync,
  ward: Ward,
  current: Board,
  importVersion: string,
  stamp: string,
): void {
  if (findCurrentId(db) !== null) {
    throw new AlreadyInitializedError();
  }
  writeWard(db, ward, stamp);
  insertBoardRow(db, {
    id: current.id,
    kind: 'current',
    name: 'Current',
    status: null,
    rationale: null,
    version: current.version,
    tabOrder: null,
    acceptedBy: null,
    acceptedAt: null,
    acceptedSummary: null,
    baselineBoardId: null,
    importVersion,
    proposalId: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  insertBoardContents(db, current);
}

export function writeProposal(db: DatabaseSync, proposal: Proposal): void {
  if (proposalConflicts(db, proposal)) {
    throw new Error(`proposal ${proposal.id} already exists`);
  }
  insertBoardRow(db, {
    id: proposal.baseline.id,
    kind: 'baseline',
    name: `${proposal.name} (baseline)`,
    status: null,
    rationale: null,
    version: proposal.baseline.version,
    tabOrder: null,
    acceptedBy: null,
    acceptedAt: null,
    acceptedSummary: null,
    baselineBoardId: null,
    importVersion: null,
    proposalId: null,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  });
  insertBoardContents(db, proposal.baseline);
  insertBoardRow(db, {
    id: proposal.board.id,
    kind: 'proposal',
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    version: proposal.board.version,
    tabOrder: proposal.tabOrder,
    acceptedBy: proposal.accepted === null ? null : proposal.accepted.by,
    acceptedAt: proposal.accepted === null ? null : proposal.accepted.at,
    acceptedSummary: proposal.accepted === null ? null : proposal.accepted.summary,
    baselineBoardId: proposal.baseline.id,
    importVersion: null,
    proposalId: proposal.id,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  });
  insertBoardContents(db, proposal.board);
}

export function replaceProposalBoard(
  db: DatabaseSync,
  board: Board,
  previousVersion: number,
  updatedAt: string,
): void {
  deleteBoardContents(db, board.id);
  insertBoardContents(db, board);
  const result = db
    .prepare('UPDATE boards SET version = ?, updated_at = ? WHERE id = ? AND version = ?')
    .run(board.version, updatedAt, board.id, previousVersion);
  if (changesOf(result) !== 1) {
    throw new Error(`board ${board.id} changed before it could be committed`);
  }
}

function proposalConflicts(db: DatabaseSync, proposal: Proposal): boolean {
  const row = db
    .prepare('SELECT id FROM boards WHERE proposal_id = ? OR id = ? OR id = ? LIMIT 1')
    .get(proposal.id, proposal.board.id, proposal.baseline.id);
  return row !== undefined;
}

function writeWard(db: DatabaseSync, ward: Ward, stamp: string): void {
  const insertTag = db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)');
  const insertMember = db.prepare(
    `INSERT INTO members (
       id, name, photo_ref, category, note, needs_approval, removed_date, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMemberTag = db.prepare(
    'INSERT INTO member_tags (member_id, tag_id, sort_order) VALUES (?, ?, ?)',
  );
  const insertExternal = db.prepare(
    'INSERT INTO external_callings (id, member_id, unit, title, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  for (const tag of Object.values(ward.tags)) {
    insertTag.run(tag.id, tag.name);
  }
  for (const member of Object.values(ward.members)) {
    insertMember.run(
      member.id,
      member.name,
      member.photoRef,
      member.category,
      member.note,
      bit(member.needsApproval),
      member.removedDate,
      stamp,
      stamp,
    );
    for (let index = 0; index < member.tagIds.length; index += 1) {
      const tag = member.tagIds[index];
      if (tag === undefined) continue;
      insertMemberTag.run(member.id, tag, index);
    }
    for (let index = 0; index < member.externalCallings.length; index += 1) {
      const calling = member.externalCallings[index];
      if (calling === undefined) continue;
      insertExternal.run(
        `${member.id}:external:${String(index)}`,
        member.id,
        calling.unit,
        calling.title,
        index,
      );
    }
  }
}

type BoardShell = {
  id: string;
  kind: BoardKind;
  name: string;
  status: ProposalStatus | null;
  rationale: string | null;
  version: number;
  tabOrder: number | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptedSummary: string | null;
  baselineBoardId: string | null;
  importVersion: string | null;
  proposalId: string | null;
  createdAt: string;
  updatedAt: string;
};

function insertBoardRow(db: DatabaseSync, row: BoardShell): void {
  db.prepare(
    `INSERT INTO boards (
       id, kind, name, status, rationale, version, tab_order,
       accepted_by, accepted_at, accepted_summary, baseline_board_id,
       import_version, created_at, updated_at, proposal_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.kind,
    row.name,
    row.status,
    row.rationale,
    row.version,
    row.tabOrder,
    row.acceptedBy,
    row.acceptedAt,
    row.acceptedSummary,
    row.baselineBoardId,
    row.importVersion,
    row.createdAt,
    row.updatedAt,
    row.proposalId,
  );
}

function insertBoardContents(db: DatabaseSync, board: Board): void {
  const insertGroup = db.prepare(
    `INSERT INTO board_groups (id, board_id, name, sort_order, visible, group_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const group of Object.values(board.boardGroups)) {
    insertGroup.run(
      scope(board.id, group.id),
      board.id,
      group.name,
      group.order,
      bit(group.visible),
      group.key,
    );
  }

  const insertCallingGroup = db.prepare(
    `INSERT INTO calling_groups (
       id, board_id, board_group_id, parent_calling_group_id, name, sort_order, kind, group_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const group of orderedCallingGroups(board.callingGroups)) {
    const parentBoard = group.parent.kind === 'boardGroup' ? scope(board.id, group.parent.id) : null;
    const parentCalling = group.parent.kind === 'callingGroup' ? scope(board.id, group.parent.id) : null;
    insertCallingGroup.run(
      scope(board.id, group.id),
      board.id,
      parentBoard,
      parentCalling,
      group.name,
      group.order,
      group.kind,
      group.key,
    );
  }

  const insertAssignment = db.prepare(
    `INSERT INTO calling_assignments (
       id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin, leadership_role
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCallingTag = db.prepare(
    'INSERT INTO calling_tags (board_id, assignment_id, tag_id, sort_order) VALUES (?, ?, ?, ?)',
  );
  const insertAffinity = db.prepare(
    'INSERT INTO calling_affinities (board_id, assignment_id, tag_id, sort_order) VALUES (?, ?, ?, ?)',
  );
  for (const assignment of Object.values(board.assignments)) {
    const assignmentRowId = scope(board.id, assignment.id);
    insertAssignment.run(
      assignmentRowId,
      board.id,
      scope(board.id, assignment.groupId),
      assignment.title,
      assignment.type,
      assignment.order,
      bit(assignment.enabled),
      bit(assignment.prominent),
      assignment.origin,
      assignment.leadershipRole,
    );
    writeTagLinks(insertCallingTag, board.id, assignmentRowId, assignment.callingTagIds);
    writeTagLinks(insertAffinity, board.id, assignmentRowId, assignment.preferredMemberTagIds);
  }

  const insertPosition = db.prepare(
    `INSERT INTO positions (id, board_id, assignment_id, lineage_id, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const position of Object.values(board.positions)) {
    insertPosition.run(
      scope(board.id, position.id),
      board.id,
      scope(board.id, position.assignmentId),
      position.lineageId,
      position.order,
    );
  }

  const insertPlacement = db.prepare(
    `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [rawPositionId, placedMember] of Object.entries(board.placements)) {
    const position = board.positions[positionId(rawPositionId)];
    if (position === undefined) {
      throw new Error(`placement ${rawPositionId} has no position on board ${board.id}`);
    }
    const positionRowId = scope(board.id, position.id);
    insertPlacement.run(
      positionRowId,
      board.id,
      positionRowId,
      scope(board.id, position.assignmentId),
      placedMember,
    );
  }

  const insertOversight = db.prepare(
    `INSERT INTO oversight (
       id, board_id, position_id, target_board_group_id, target_calling_group_id, fixed, overseer, sort_order
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < board.oversight.length; index += 1) {
    const item = board.oversight[index];
    if (item === undefined) continue;
    const targetBoard = item.target.kind === 'boardGroup' ? scope(board.id, item.target.id) : null;
    const targetCalling = item.target.kind === 'callingGroup' ? scope(board.id, item.target.id) : null;
    insertOversight.run(
      `${board.id}:oversight:${String(index)}`,
      board.id,
      targetBoard,
      targetCalling,
      bit(item.fixed),
      item.overseer,
      index,
    );
  }

  const insertDugout = db.prepare(
    'INSERT INTO dugout_inclusions (board_id, member_id, sort_order) VALUES (?, ?, ?)',
  );
  for (let index = 0; index < board.dugoutInclusions.length; index += 1) {
    const included = board.dugoutInclusions[index];
    if (included === undefined) continue;
    insertDugout.run(board.id, included, index);
  }

  const insertApproval = db.prepare(
    `INSERT INTO approvals (id, board_id, member_id, position_id, approver_user_id, approved_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < board.approvals.length; index += 1) {
    const approval = board.approvals[index];
    if (approval === undefined) continue;
    insertApproval.run(
      `${board.id}:approval:${String(index)}`,
      board.id,
      approval.memberId,
      scope(board.id, approval.positionId),
      approval.approvedBy,
      approval.approvedAt,
    );
  }
}

function writeTagLinks(
  statement: { run: (...params: (string | number | null)[]) => unknown },
  ownerBoardId: string,
  assignmentRowId: string,
  tagIds: readonly TagId[],
): void {
  for (let index = 0; index < tagIds.length; index += 1) {
    const tag = tagIds[index];
    if (tag === undefined) continue;
    statement.run(ownerBoardId, assignmentRowId, tag, index);
  }
}

function deleteBoardContents(db: DatabaseSync, ownerBoardId: string): void {
  db.prepare('DELETE FROM approvals WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM dugout_inclusions WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM calling_tags WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM calling_affinities WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM placements WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM oversight WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM positions WHERE board_id = ?').run(ownerBoardId);
  db.prepare('DELETE FROM calling_assignments WHERE board_id = ?').run(ownerBoardId);
  deleteCallingGroups(db, ownerBoardId);
  db.prepare('DELETE FROM board_groups WHERE board_id = ?').run(ownerBoardId);
}

function deleteCallingGroups(db: DatabaseSync, ownerBoardId: string): void {
  const leaves = db.prepare(
    `SELECT id FROM calling_groups
     WHERE board_id = ?
       AND id NOT IN (
         SELECT parent_calling_group_id FROM calling_groups
         WHERE board_id = ? AND parent_calling_group_id IS NOT NULL
       )`,
  );
  const remove = db.prepare('DELETE FROM calling_groups WHERE id = ?');
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM calling_groups WHERE board_id = ?');
  for (let guard = 0; guard < 10000; guard += 1) {
    const batch = leaves.all(ownerBoardId, ownerBoardId);
    if (batch.length === 0) {
      const count = remaining.get(ownerBoardId);
      const left = count === undefined ? 0 : integer(count, 'n');
      if (left !== 0) {
        throw new Error(`calling groups for ${ownerBoardId} could not be deleted`);
      }
      return;
    }
    for (const leaf of batch) {
      remove.run(text(leaf, 'id'));
    }
  }
  throw new Error(`calling groups for ${ownerBoardId} could not be deleted`);
}

function orderedCallingGroups(groups: Board['callingGroups']): CallingGroup[] {
  const pending = new Map<string, CallingGroup>(Object.entries(groups));
  const ordered: CallingGroup[] = [];
  const placed = new Set<string>();
  while (pending.size > 0) {
    const ready: string[] = [];
    for (const [id, group] of pending) {
      if (group.parent.kind === 'boardGroup' || placed.has(group.parent.id)) {
        ready.push(id);
      }
    }
    if (ready.length === 0) {
      throw new Error('calling group parents are cyclic or missing');
    }
    for (const id of ready) {
      const group = pending.get(id);
      if (group === undefined) continue;
      ordered.push(group);
      placed.add(id);
      pending.delete(id);
    }
  }
  return ordered;
}

function readBoardGroups(db: DatabaseSync, ownerBoardId: string): Record<BoardGroupId, BoardGroup> {
  const groups: Record<BoardGroupId, BoardGroup> = {};
  for (const row of db
    .prepare(
      `SELECT id, name, sort_order, visible, group_key
       FROM board_groups WHERE board_id = ? ORDER BY sort_order, id`,
    )
    .all(ownerBoardId)) {
    const id = boardGroupId(unscope(text(row, 'id'), ownerBoardId));
    assign(groups, id, {
      id,
      name: text(row, 'name'),
      order: integer(row, 'sort_order'),
      visible: flag(row, 'visible'),
      key: oneOfOrNull(BOARD_GROUP_KEYS, textOrNull(row, 'group_key'), 'board group key'),
    });
  }
  return groups;
}

function readCallingGroups(db: DatabaseSync, ownerBoardId: string): Record<CallingGroupId, CallingGroup> {
  const groups: Record<CallingGroupId, CallingGroup> = {};
  for (const row of db
    .prepare(
      `SELECT id, board_group_id, parent_calling_group_id, name, sort_order, kind, group_key
       FROM calling_groups WHERE board_id = ? ORDER BY sort_order, id`,
    )
    .all(ownerBoardId)) {
    const id = callingGroupId(unscope(text(row, 'id'), ownerBoardId));
    const parentBoard = textOrNull(row, 'board_group_id');
    const parentCalling = textOrNull(row, 'parent_calling_group_id');
    let parent: CallingGroup['parent'];
    if (parentBoard !== null && parentCalling === null) {
      parent = { kind: 'boardGroup', id: boardGroupId(unscope(parentBoard, ownerBoardId)) };
    } else if (parentBoard === null && parentCalling !== null) {
      parent = { kind: 'callingGroup', id: callingGroupId(unscope(parentCalling, ownerBoardId)) };
    } else {
      throw new Error(`calling group ${id} has an invalid parent`);
    }
    const key = textOrNull(row, 'group_key');
    if (key !== null && key.length === 0) {
      throw new Error(`calling group ${id} has an empty key`);
    }
    assign(groups, id, {
      id,
      name: text(row, 'name'),
      order: integer(row, 'sort_order'),
      parent,
      kind: oneOf(CALLING_GROUP_KINDS, text(row, 'kind'), 'calling group kind'),
      key,
    });
  }
  return groups;
}

function readAssignments(
  db: DatabaseSync,
  ownerBoardId: string,
): Record<AssignmentId, CallingAssignment> {
  const callingTags = tagsByAssignment(db, ownerBoardId, 'calling_tags');
  const affinities = tagsByAssignment(db, ownerBoardId, 'calling_affinities');
  const assignments: Record<AssignmentId, CallingAssignment> = {};
  for (const row of db
    .prepare(
      `SELECT id, calling_group_id, title, type, sort_order, enabled, prominence, origin, leadership_role
       FROM calling_assignments WHERE board_id = ? ORDER BY sort_order, id`,
    )
    .all(ownerBoardId)) {
    const storedId = text(row, 'id');
    const id = assignmentId(unscope(storedId, ownerBoardId));
    assign(assignments, id, {
      id,
      groupId: callingGroupId(unscope(text(row, 'calling_group_id'), ownerBoardId)),
      title: text(row, 'title'),
      type: oneOf(ASSIGNMENT_TYPES, text(row, 'type'), 'assignment type'),
      order: integer(row, 'sort_order'),
      enabled: flag(row, 'enabled'),
      prominent: flag(row, 'prominence'),
      origin: oneOf(ASSIGNMENT_ORIGINS, text(row, 'origin'), 'assignment origin'),
      leadershipRole: oneOfOrNull(LEADERSHIP_ROLES, textOrNull(row, 'leadership_role'), 'leadership role'),
      callingTagIds: callingTags.get(storedId) ?? [],
      preferredMemberTagIds: affinities.get(storedId) ?? [],
    });
  }
  return assignments;
}

function readPositions(db: DatabaseSync, ownerBoardId: string): Record<PositionId, Position> {
  const positions: Record<PositionId, Position> = {};
  for (const row of db
    .prepare(
      `SELECT id, assignment_id, lineage_id, sort_order
       FROM positions WHERE board_id = ? ORDER BY sort_order, id`,
    )
    .all(ownerBoardId)) {
    const id = positionId(unscope(text(row, 'id'), ownerBoardId));
    assign(positions, id, {
      id,
      assignmentId: assignmentId(unscope(text(row, 'assignment_id'), ownerBoardId)),
      lineageId: lineageId(text(row, 'lineage_id')),
      order: integer(row, 'sort_order'),
    });
  }
  return positions;
}

function readPlacements(db: DatabaseSync, ownerBoardId: string): Record<PositionId, MemberId> {
  const placements: Record<PositionId, MemberId> = {};
  for (const row of db
    .prepare('SELECT position_id, member_id FROM placements WHERE board_id = ?')
    .all(ownerBoardId)) {
    const id = positionId(unscope(text(row, 'position_id'), ownerBoardId));
    assign(placements, id, memberId(text(row, 'member_id')));
  }
  return placements;
}

function readOversight(db: DatabaseSync, ownerBoardId: string): Oversight[] {
  const items: Oversight[] = [];
  for (const row of db
    .prepare(
      `SELECT id, target_board_group_id, target_calling_group_id, fixed, overseer
       FROM oversight WHERE board_id = ? ORDER BY sort_order, id`,
    )
    .all(ownerBoardId)) {
    const targetBoard = textOrNull(row, 'target_board_group_id');
    const targetCalling = textOrNull(row, 'target_calling_group_id');
    let target: Oversight['target'];
    if (targetBoard !== null && targetCalling === null) {
      target = { kind: 'boardGroup', id: boardGroupId(unscope(targetBoard, ownerBoardId)) };
    } else if (targetBoard === null && targetCalling !== null) {
      target = { kind: 'callingGroup', id: callingGroupId(unscope(targetCalling, ownerBoardId)) };
    } else {
      throw new Error(`oversight ${text(row, 'id')} has an invalid target`);
    }
    const overseer = textOrNull(row, 'overseer');
    if (overseer === null) {
      throw new Error(`oversight ${text(row, 'id')} is missing overseer`);
    }
    items.push({
      overseer: oneOf(OVERSEERS, overseer, 'overseer'),
      target,
      fixed: flag(row, 'fixed'),
    });
  }
  return items;
}

function readDugout(db: DatabaseSync, ownerBoardId: string): MemberId[] {
  return db
    .prepare(
      `SELECT member_id FROM dugout_inclusions
       WHERE board_id = ? ORDER BY sort_order, member_id`,
    )
    .all(ownerBoardId)
    .map((row) => memberId(text(row, 'member_id')));
}

function readApprovals(db: DatabaseSync, ownerBoardId: string): Board['approvals'][number][] {
  const prefix = `${ownerBoardId}:approval:`;
  const rows = db
    .prepare(
      `SELECT id, member_id, position_id, approver_user_id, approved_at
       FROM approvals WHERE board_id = ?`,
    )
    .all(ownerBoardId)
    .map((row) => ({ row, index: indexFrom(text(row, 'id'), prefix) }))
    .sort((left, right) => left.index - right.index);
  return rows.map(({ row }) => ({
    memberId: memberId(text(row, 'member_id')),
    positionId: positionId(unscope(text(row, 'position_id'), ownerBoardId)),
    approvedBy: userId(text(row, 'approver_user_id')),
    approvedAt: text(row, 'approved_at'),
  }));
}

function tagsByAssignment(
  db: DatabaseSync,
  ownerBoardId: string,
  table: 'calling_tags' | 'calling_affinities',
): Map<string, TagId[]> {
  const map = new Map<string, TagId[]>();
  for (const row of db
    .prepare(
      `SELECT assignment_id, tag_id FROM ${table}
       WHERE board_id = ? ORDER BY assignment_id, sort_order, tag_id`,
    )
    .all(ownerBoardId)) {
    const assignment = text(row, 'assignment_id');
    const tags = map.get(assignment) ?? [];
    tags.push(tagId(text(row, 'tag_id')));
    map.set(assignment, tags);
  }
  return map;
}

function acceptance(row: SqlRow, status: ProposalStatus, id: string): ProposalAcceptance | null {
  const by = textOrNull(row, 'accepted_by');
  const at = textOrNull(row, 'accepted_at');
  const summary = textOrNull(row, 'accepted_summary');
  if (status === 'draft') {
    if (by !== null || at !== null || summary !== null) {
      throw new Error(`draft proposal ${id} has acceptance details`);
    }
    return null;
  }
  if (by === null || at === null || summary === null) {
    throw new Error(`accepted proposal ${id} is missing acceptance details`);
  }
  return { by: userId(by), at, summary };
}

function rollBack(db: DatabaseSync, original: unknown): void {
  if (!db.isTransaction) return;
  try {
    db.exec('ROLLBACK');
  } catch (rollbackError: unknown) {
    throw new Error(
      `rollback failed: ${errorMessage(rollbackError)}; original: ${errorMessage(original)}`,
      { cause: rollbackError },
    );
  }
}

function changesOf(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function must<T>(result: Result<T>, label: string): T {
  if (result.ok) return result.value;
  const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
  throw new Error(`${label} failed validation: ${detail}`);
}

function scope(ownerId: string, coreId: string): string {
  return `${ownerId}:${coreId}`;
}

function unscope(stored: string, ownerId: string): string {
  const prefix = `${ownerId}:`;
  if (!stored.startsWith(prefix)) {
    throw new Error(`stored id ${stored} does not start with ${prefix}`);
  }
  const core = stored.slice(prefix.length);
  if (core.length === 0) {
    throw new Error(`stored id ${stored} has an empty core id`);
  }
  return core;
}

function indexFrom(stored: string, prefix: string): number {
  if (!stored.startsWith(prefix)) {
    throw new Error(`stored id ${stored} does not start with ${prefix}`);
  }
  const raw = stored.slice(prefix.length);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`stored id ${stored} has a non-numeric index`);
  }
  return Number(raw);
}

function assign<K extends string, V>(record: Record<K, V>, key: K, value: V): void {
  if (Object.hasOwn(record, key)) {
    throw new Error(`duplicate id ${key}`);
  }
  record[key] = value;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, label: string): T {
  for (const item of allowed) {
    if (item === value) return item;
  }
  throw new Error(`unknown ${label} ${value}`);
}

function oneOfOrNull<T extends string>(
  allowed: readonly T[],
  value: string | null,
  label: string,
): T | null {
  if (value === null) return null;
  return oneOf(allowed, value, label);
}

function text(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be text`);
  }
  return value;
}

function textOrNull(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${key} must be text or null`);
  }
  return value;
}

function integer(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  throw new Error(`${key} must be an integer`);
}

function flag(row: SqlRow, key: string): boolean {
  const value = integer(row, key);
  if (value === 1) return true;
  if (value === 0) return false;
  throw new Error(`${key} must be 0 or 1`);
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}
