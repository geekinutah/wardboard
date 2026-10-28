import type { DatabaseSync } from 'node:sqlite';
import {
  boardId,
  createBoard,
  createProposal,
  createTag as createTagRecord,
  createWard,
  deleteTag as deleteTagRecord,
  dropAllApprovals,
  dropMemberApprovals,
  proposalId,
  renameTag as renameTagRecord,
  setMemberTags,
  tagUsage as tagUsageOf,
  type Board,
  type BoardKind,
  type IdGenerator,
  type MemberId,
  type ProposalId,
  type TagId,
  type TagUsage,
  type Ward,
} from '@wardboard/core';
import {
  AlreadyInitializedError,
  deleteStoredTag,
  errorMessage,
  findCurrentId,
  insertTag,
  listProposalSummaries,
  nextTabOrder,
  readBoard,
  readBoardMeta,
  readCurrentRecord,
  readProposal,
  readShowNeedsApproval,
  readWard,
  renameStoredTag,
  replaceBoardContents,
  replaceProposalBoard,
  withImmediateTransaction,
  writeInitialization,
  writeMemberProfile,
  writeNeedsApproval,
  writeProposal,
  writeProposalAcceptance,
  writeProposalMeta,
  writeShowNeedsApproval,
} from './persist.ts';
import type { Store, StoreClock, StoreError, StoreResult } from './types.ts';

export type {
  CurrentRecord,
  ProposalSummary,
  Store,
  StoreClock,
  StoreError,
  StoreResult,
} from './types.ts';

function ok<T>(value: T): StoreResult<T> {
  return { ok: true, value };
}

function okVoid(): StoreResult<void> {
  return { ok: true, value: undefined };
}

function fail(error: StoreError): StoreResult<never> {
  return { ok: false, error };
}

function invalid(message: string): StoreResult<never> {
  return fail({ code: 'invalid', message });
}

function invalidResult(errors: readonly { path: string; message: string }[]): StoreResult<never> {
  return invalid(invalidMessage(errors));
}

function invalidMessage(errors: readonly { path: string; message: string }[]): string {
  const message = errors.map((error) => `${error.path}: ${error.message}`).join('; ');
  return message.length > 0 ? message : 'invalid';
}

class Refusal extends Error {
  readonly failure: StoreError;

  constructor(failure: StoreError) {
    super(failure.message);
    this.name = 'Refusal';
    this.failure = failure;
  }
}

function stampOf(clock: StoreClock): string {
  return clock().toISOString();
}

function copyBoard(board: Board, id: string, kind: BoardKind, version: number): Board {
  return {
    id: boardId(id),
    kind,
    version,
    boardGroups: board.boardGroups,
    callingGroups: board.callingGroups,
    assignments: board.assignments,
    positions: board.positions,
    placements: board.placements,
    oversight: board.oversight,
    dugoutInclusions: board.dugoutInclusions,
    approvals: board.approvals,
  };
}

export function openStore(db: DatabaseSync, clock: StoreClock): Store {
  return {
    initialize(input) {
      if (findCurrentId(db) !== null) {
        return fail({ code: 'already_initialized', message: 'a current board already exists' });
      }
      const ward = createWard(input.ward);
      if (!ward.ok) return invalidResult(ward.errors);
      if (input.current.kind !== 'current') {
        return invalid('current.kind must be current');
      }
      const current = createBoard(input.current, ward.value);
      if (!current.ok) return invalidResult(current.errors);
      const stamp = stampOf(clock);
      try {
        withImmediateTransaction(db, () => {
          writeInitialization(db, ward.value, current.value, input.importVersion, stamp);
        });
      } catch (error: unknown) {
        if (error instanceof AlreadyInitializedError) {
          return fail({ code: 'already_initialized', message: error.message });
        }
        throw error;
      }
      return okVoid();
    },

    loadWard() {
      return readWard(db);
    },

    loadCurrent() {
      return readCurrentRecord(db);
    },

    listProposals() {
      return listProposalSummaries(db);
    },

    loadProposal(id) {
      return readProposal(db, id);
    },

    loadBoard(id) {
      return readBoard(db, id, readWard(db));
    },

    insertProposal(proposal) {
      const ward = readWard(db);
      const validated = createProposal(proposal, ward);
      if (!validated.ok) return invalidResult(validated.errors);
      try {
        withImmediateTransaction(db, () => {
          writeProposal(db, validated.value);
        });
      } catch (error: unknown) {
        return invalid(errorMessage(error));
      }
      return okVoid();
    },

    createProposal(input, ids: IdGenerator) {
      const source = resolveSource(db, input.source);
      if (!source.ok) return source;
      const id = ids();
      const at = stampOf(clock);
      const ward = readWard(db);
      const copiedBoard = copyBoard(source.board, `${id}-board`, 'proposal', 0);
      // SPEC §6: duplicating never copies approvals. A proposal started from
      // Current still snapshots Current, approvals included.
      const workingBoard =
        input.source.kind === 'proposal' ? dropAllApprovals(copiedBoard, ward) : copiedBoard;
      const validated = createProposal(
        {
          id: proposalId(id),
          name: input.name,
          rationale: input.rationale,
          status: 'draft',
          accepted: null,
          baseline: copyBoard(source.baseline, `${id}-baseline`, 'baseline', 0),
          board: workingBoard,
          tabOrder: nextTabOrder(db),
          createdAt: at,
          updatedAt: at,
        },
        ward,
      );
      if (!validated.ok) return invalidResult(validated.errors);
      try {
        withImmediateTransaction(db, () => {
          writeProposal(db, validated.value);
        });
      } catch (error: unknown) {
        return invalid(errorMessage(error));
      }
      const loaded = readProposal(db, validated.value.id);
      if (loaded === null) {
        throw new Error(`proposal ${validated.value.id} missing after insert`);
      }
      return ok(loaded);
    },

    // Existence, then editability, then version, then payload kind, then validation.
    commitBoard(next, expectedVersion) {
      const meta = readBoardMeta(db, next.id);
      if (meta === null) {
        return fail({ code: 'not_found', message: `board ${next.id} does not exist` });
      }
      if (meta.kind !== 'proposal' || meta.status === 'accepted') {
        const reason =
          meta.status === 'accepted'
            ? 'accepted proposals cannot be edited'
            : `board ${next.id} is ${meta.kind} and cannot be edited`;
        return fail({ code: 'not_editable', message: reason });
      }
      if (meta.version !== expectedVersion) {
        return fail({
          code: 'stale',
          message: `board ${next.id} version is ${String(meta.version)}, expected ${String(expectedVersion)}`,
          currentVersion: meta.version,
        });
      }
      if (next.kind !== 'proposal') {
        return fail({ code: 'not_editable', message: `commit payload kind is ${next.kind}` });
      }
      const validated = createBoard({ ...next, version: expectedVersion + 1 }, readWard(db));
      if (!validated.ok) return invalidResult(validated.errors);
      const stamp = stampOf(clock);
      try {
        withImmediateTransaction(db, () => {
          replaceProposalBoard(db, validated.value, expectedVersion, stamp);
        });
      } catch (error: unknown) {
        return invalid(errorMessage(error));
      }
      const loaded = readBoard(db, next.id, readWard(db));
      if (loaded === null) {
        throw new Error(`board ${next.id} missing after commit`);
      }
      return ok(loaded);
    },

    updateProposalMeta(id, meta) {
      const stamp = stampOf(clock);
      try {
        withImmediateTransaction(db, () => {
          const existing = readProposal(db, id);
          if (existing === null) {
            throw new Refusal({ code: 'not_found', message: `proposal ${id} does not exist` });
          }
          if (existing.status === 'accepted') {
            throw new Refusal({ code: 'not_editable', message: 'accepted proposals cannot be edited' });
          }
          const validated = createProposal(
            { ...existing, name: meta.name, rationale: meta.rationale, updatedAt: stamp },
            readWard(db),
          );
          if (!validated.ok) {
            throw new Refusal({ code: 'invalid', message: invalidMessage(validated.errors) });
          }
          writeProposalMeta(db, id, validated.value.name, validated.value.rationale, stamp);
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      const loaded = readProposal(db, id);
      if (loaded === null) {
        throw new Error(`proposal ${id} missing after update`);
      }
      return ok(loaded);
    },

    setProposalAcceptance(id, accepted) {
      const stamp = stampOf(clock);
      try {
        withImmediateTransaction(db, () => {
          const existing = readProposal(db, id);
          if (existing === null) {
            throw new Refusal({ code: 'not_found', message: `proposal ${id} does not exist` });
          }
          const validated = createProposal(
            {
              ...existing,
              status: accepted === null ? 'draft' : 'accepted',
              accepted,
              updatedAt: stamp,
            },
            readWard(db),
          );
          if (!validated.ok) {
            throw new Refusal({ code: 'invalid', message: invalidMessage(validated.errors) });
          }
          const recorded = validated.value.accepted;
          writeProposalAcceptance(
            db,
            id,
            validated.value.status,
            recorded === null ? null : recorded.by,
            recorded === null ? null : recorded.at,
            recorded === null ? null : recorded.summary,
            stamp,
          );
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      const loaded = readProposal(db, id);
      if (loaded === null) {
        throw new Error(`proposal ${id} missing after acceptance update`);
      }
      return ok(loaded);
    },

    updateMemberProfile(id, patch) {
      const stamp = stampOf(clock);
      try {
        withImmediateTransaction(db, () => {
          const applied = applyMemberProfile(readWard(db), id, patch);
          if (!applied.ok) throw new Refusal(applied.error);
          const stored = applied.value.members[id];
          if (stored === undefined) {
            throw new Refusal({ code: 'not_found', message: `member ${id} does not exist` });
          }
          writeMemberProfile(
            db,
            stored.id,
            stored.name,
            stored.note,
            patch.tagIds === undefined ? null : stored.tagIds,
            stamp,
          );
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      return ok(readWard(db));
    },

    createTag(name, ids) {
      let createdId: TagId;
      try {
        createdId = withImmediateTransaction(db, () => {
          const created = createTagRecord(readWard(db), ids, name);
          if (!created.ok) {
            throw new Refusal({ code: 'invalid', message: created.error.message });
          }
          const tag = created.value.ward.tags[created.value.tagId];
          if (tag === undefined) {
            throw new Error(`tag ${created.value.tagId} missing after create`);
          }
          insertTag(db, tag.id, tag.name);
          return tag.id;
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      return ok({ ward: readWard(db), tagId: createdId });
    },

    renameTag(id, name) {
      try {
        withImmediateTransaction(db, () => {
          const renamed = renameTagRecord(readWard(db), id, name);
          if (!renamed.ok) throw new Refusal(tagStoreError(renamed.error));
          const tag = renamed.value.tags[id];
          if (tag === undefined) throw new Error(`tag ${id} missing after rename`);
          renameStoredTag(db, tag.id, tag.name);
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      return ok(readWard(db));
    },

    setNeedsApproval(id, value) {
      const stamp = stampOf(clock);
      const changedIds: string[] = [];
      try {
        withImmediateTransaction(db, () => {
          const ward = readWard(db);
          const member = ward.members[id];
          if (member === undefined) {
            throw new Refusal({ code: 'not_found', message: `member ${id} does not exist` });
          }
          if (member.needsApproval === value) {
            throw new Refusal({ code: 'invalid', message: 'no change' });
          }
          const validated = createWard({
            tags: ward.tags,
            members: { ...ward.members, [id]: { ...member, needsApproval: value } },
          });
          if (!validated.ok) {
            throw new Refusal({ code: 'invalid', message: invalidMessage(validated.errors) });
          }
          writeNeedsApproval(db, id, value, stamp);
          if (!value) return;
          for (const summary of listProposalSummaries(db)) {
            if (summary.status !== 'draft') continue;
            const proposal = readProposal(db, summary.id);
            if (proposal === null) continue;
            const dropped = dropMemberApprovals(proposal.board, validated.value, id);
            if (dropped.approvals.length === proposal.board.approvals.length) continue;
            replaceProposalBoard(
              db,
              { ...dropped, version: proposal.board.version + 1 },
              proposal.board.version,
              stamp,
            );
            changedIds.push(proposal.board.id);
          }
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      const stored = readWard(db);
      const boards: Board[] = [];
      for (const changedId of changedIds) {
        const board = readBoard(db, changedId, stored);
        if (board === null) throw new Error(`board ${changedId} missing after needs-approval update`);
        boards.push(board);
      }
      return ok({ ward: stored, boards });
    },

    deleteTag(id) {
      const stamp = stampOf(clock);
      const changedIds: string[] = [];
      try {
        withImmediateTransaction(db, () => {
          const ward = readWard(db);
          if (ward.tags[id] === undefined) {
            throw new Refusal({ code: 'not_found', message: `tag ${id} does not exist` });
          }
          const boards = readAllBoards(db);
          const deleted = deleteTagRecord(ward, boards, id);
          if (!deleted.ok) throw new Refusal(tagStoreError(deleted.error));
          for (let index = 0; index < boards.length; index += 1) {
            const before = boards[index];
            const after = deleted.value.boards[index];
            if (before === undefined || after === undefined) {
              throw new Error('deleteTag returned a different number of boards');
            }
            if (!usesTag(before, id)) continue;
            if (before.kind === 'baseline') {
              replaceBoardContents(db, after);
              continue;
            }
            replaceProposalBoard(db, { ...after, version: before.version + 1 }, before.version, stamp);
            changedIds.push(before.id);
          }
          deleteStoredTag(db, id);
        });
      } catch (error: unknown) {
        if (error instanceof Refusal) return fail(error.failure);
        return invalid(errorMessage(error));
      }
      const stored = readWard(db);
      const boards: Board[] = [];
      for (const changedId of changedIds) {
        const board = readBoard(db, changedId, stored);
        if (board === null) throw new Error(`board ${changedId} missing after tag delete`);
        boards.push(board);
      }
      return ok({ ward: stored, boards });
    },

    tagUsage(id) {
      return withImmediateTransaction(db, (): StoreResult<TagUsage> => {
        const ward = readWard(db);
        if (ward.tags[id] === undefined) {
          return fail({ code: 'not_found', message: `tag ${id} does not exist` });
        }
        const boards = readAllBoards(db).filter((board) => board.kind !== 'baseline');
        return ok(tagUsageOf(ward, boards, id));
      });
    },

    loadSettings() {
      return withImmediateTransaction(db, () => ({ showNeedsApproval: readShowNeedsApproval(db) }));
    },

    setShowNeedsApproval(value) {
      withImmediateTransaction(db, () => {
        writeShowNeedsApproval(db, value);
      });
    },
  };
}

function applyMemberProfile(
  ward: Ward,
  id: MemberId,
  patch: { name?: string; note?: string | null; tagIds?: readonly TagId[] },
): StoreResult<Ward> {
  if (ward.members[id] === undefined) {
    return fail({ code: 'not_found', message: `member ${id} does not exist` });
  }
  let next = ward;
  if (patch.name !== undefined || patch.note !== undefined) {
    const current = next.members[id];
    if (current === undefined) {
      return fail({ code: 'not_found', message: `member ${id} does not exist` });
    }
    const validated = createWard({
      tags: next.tags,
      members: {
        ...next.members,
        [id]: {
          ...current,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
        },
      },
    });
    if (!validated.ok) return invalidResult(validated.errors);
    next = validated.value;
  }
  if (patch.tagIds !== undefined) {
    const tagged = setMemberTags(next, id, patch.tagIds);
    if (!tagged.ok) {
      if (tagged.error.code === 'not_found' && next.members[id] === undefined) {
        return fail({ code: 'not_found', message: tagged.error.message });
      }
      return invalid(tagged.error.message);
    }
    next = tagged.value;
  }
  return ok(next);
}

/** Current, then each proposal's working board and baseline, in tab order. */
function readAllBoards(db: DatabaseSync): Board[] {
  const boards: Board[] = [];
  const current = readCurrentRecord(db);
  if (current !== null) boards.push(current.board);
  for (const summary of listProposalSummaries(db)) {
    const proposal = readProposal(db, summary.id);
    if (proposal === null) throw new Error(`proposal ${summary.id} missing`);
    boards.push(proposal.board, proposal.baseline);
  }
  return boards;
}

function usesTag(board: Board, id: TagId): boolean {
  return Object.values(board.assignments).some(
    (calling) => calling.callingTagIds.includes(id) || calling.preferredMemberTagIds.includes(id),
  );
}

function tagStoreError(error: { code: string; message: string }): StoreError {
  if (error.code === 'not_found') return { code: 'not_found', message: error.message };
  return { code: 'invalid', message: error.message };
}

type ResolvedSource =
  | { ok: true; baseline: Board; board: Board }
  | { ok: false; error: StoreError };

function resolveSource(
  db: DatabaseSync,
  source: { kind: 'current' } | { kind: 'proposal'; id: ProposalId },
): ResolvedSource {
  if (source.kind === 'current') {
    const current = readCurrentRecord(db);
    if (current === null) {
      return { ok: false, error: { code: 'no_current', message: 'no current board' } };
    }
    return { ok: true, baseline: current.board, board: current.board };
  }
  const proposal = readProposal(db, source.id);
  if (proposal === null) {
    return { ok: false, error: { code: 'not_found', message: `proposal ${source.id} does not exist` } };
  }
  return { ok: true, baseline: proposal.baseline, board: proposal.board };
}
