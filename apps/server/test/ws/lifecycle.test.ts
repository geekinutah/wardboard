import type { DatabaseSync } from 'node:sqlite';
import {
  createBoard,
  createWard,
  memberId,
  proposalId,
  removePosition,
  sequentialIds,
  type Board,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '../../src/index.ts';
import {
  ADMIN,
  EDITOR,
  FIXED_TIME,
  Inbox,
  asRecord,
  cleanup,
  memberNamed,
  occupiedPosition,
  openSocket,
  opMessage,
  requireBoard,
  seedDraftProposals,
  startAdmin,
  startSession,
  subscribe,
  vacantPosition,
} from './helpers.ts';

afterEach(cleanup);

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`expected ${key} to be a non-empty string`);
  }
  return value;
}

async function nextRecord(inbox: Inbox): Promise<Record<string, unknown>> {
  return asRecord(await inbox.next());
}

function expectRejected(message: Record<string, unknown>, requestId: string, code: string): void {
  expect(message).toMatchObject({ type: 'rejected', requestId, code });
  expect(typeof message.message).toBe('string');
  expect(message.message).not.toBe('');
}

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function positionHeldBy(board: Board, member: string): string {
  const found = Object.entries(board.placements).find(([, occupant]) => occupant === member);
  const id = found?.[0];
  if (id === undefined) throw new Error(`member ${member} is not placed`);
  return id;
}

function detailFrom(proposal: Proposal, accepted: unknown): Record<string, unknown> {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
    boardId: proposal.board.id,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    accepted,
  };
}

function parsedSummary(summary: string): unknown {
  const value: unknown = JSON.parse(summary);
  return value;
}

function namesIn(summary: unknown): string[] {
  if (!Array.isArray(summary)) throw new Error('summary is not an array');
  const names: string[] = [];
  for (const group of summary) {
    if (typeof group !== 'object' || group === null) continue;
    const record = group as Record<string, unknown>;
    for (const key of ['callings', 'releases']) {
      const lines = record[key];
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        if (typeof line !== 'object' || line === null || Array.isArray(line)) continue;
        const name = asRecord(line).name;
        if (typeof name === 'string') names.push(name);
      }
    }
  }
  return names;
}

function snapshotOf(store: Store): unknown {
  return {
    current: store.loadCurrent(),
    proposals: store.listProposals().map((item) => store.loadProposal(item.id)),
  };
}

function seedRemovedMember(store: Store): void {
  const { ward, current } = buildFixtureWard();
  const ada = Object.values(ward.members).find((member) => member.name === 'Ada Fictional');
  if (ada === undefined) throw new Error('missing Ada Fictional');
  const changed = createWard({
    tags: ward.tags,
    members: { ...ward.members, [ada.id]: { ...ada, removedDate: '2026-02-01' } },
  });
  if (!changed.ok) throw new Error(changed.errors.map((error) => error.message).join('; '));
  const initialized = store.initialize({ ward: changed.value, current, importVersion: 'fixture' });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const created = store.createProposal(
    { name: 'Removed member', rationale: null, source: { kind: 'current' } },
    sequentialIds('removed-member'),
  );
  if (!created.ok) throw new Error(created.error.message);
}

function vacantListPosition(board: Board, title: string): PositionId {
  const assignment = Object.values(board.assignments).find((item) => item.title === title && item.type === 'list');
  if (assignment === undefined) throw new Error(`missing list ${title}`);
  const vacant = Object.values(board.positions).find(
    (position) => position.assignmentId === assignment.id && !Object.hasOwn(board.placements, position.id),
  );
  if (vacant === undefined) throw new Error(`no vacant ${title}`);
  return vacant.id;
}

function currentWithout(current: Board, ward: Ward, removedId: PositionId): Board {
  const editable = createBoard({ ...current, kind: 'proposal' }, ward);
  if (!editable.ok) throw new Error(editable.errors.map((error) => error.message).join('; '));
  const trimmed = removePosition(editable.value, { ward, ids: sequentialIds('trim') }, { positionId: removedId });
  if (!trimmed.ok) throw new Error(trimmed.error.message);
  const restored = createBoard({ ...trimmed.board, id: current.id, kind: 'current', version: current.version }, ward);
  if (!restored.ok) throw new Error(restored.errors.map((error) => error.message).join('; '));
  return restored.value;
}

function seedRemovedPosition(store: Store): void {
  const { ward, current } = buildFixtureWard();
  const latest = currentWithout(current, ward, vacantListPosition(current, 'Elders Quorum Instructor'));
  const initialized = store.initialize({ ward, current: latest, importVersion: 'fixture' });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const inserted = store.insertProposal(
    buildFixtureProposal(current, ward, { id: proposalId('pr-removed-position'), name: 'Removed position' }),
  );
  if (!inserted.ok) throw new Error(inserted.error.message);
}

async function refusedAccept(
  seed: (store: Store, db: DatabaseSync) => void,
  code: string,
  message: string,
): Promise<void> {
  const session = await startAdmin(seed);
  const summary = session.store.listProposals()[0];
  if (summary === undefined) throw new Error('missing proposal');
  const ws = await openSocket(session);
  const inbox = new Inbox(ws);
  send(ws, { type: 'setProposalStatus', requestId: 'refuse', proposalId: summary.id, status: 'accepted' });
  const rejected = await nextRecord(inbox);
  expectRejected(rejected, 'refuse', code);
  expect(rejected.message).toBe(message);
  expect(session.store.loadProposal(summary.id)?.status).toBe('draft');
  expect(session.store.loadProposal(summary.id)?.accepted).toBeNull();
}

describe('proposal lifecycle channel', () => {
  it('createProposal from current and duplicate: sender gets proposalCreated, all connections get boards', async () => {
    const session = await startAdmin(seedDraftProposals(0));
    const sender = await openSocket(session);
    const senderInbox = new Inbox(sender);
    const watcher = await openSocket(session);
    const watcherInbox = new Inbox(watcher);

    const createdPending = senderInbox.next();
    const senderBoardsPending = senderInbox.next();
    const watcherBoardsPending = watcherInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'create-1',
      name: '  Spring plan  ',
      rationale: '   ',
      source: { kind: 'current' },
    });

    const created = asRecord(await createdPending);
    const proposalIdValue = requiredString(created, 'proposalId');
    const boardId = requiredString(created, 'boardId');
    expect(created).toEqual({
      type: 'proposalCreated',
      requestId: 'create-1',
      proposalId: proposalIdValue,
      boardId,
    });
    const senderBoards = asRecord(await senderBoardsPending);
    const watcherBoards = asRecord(await watcherBoardsPending);
    expect(senderBoards.type).toBe('boards');
    expect(watcherBoards).toEqual(senderBoards);

    const listedPending = senderInbox.next();
    send(sender, { type: 'listBoards' });
    expect(asRecord(await listedPending)).toEqual(senderBoards);

    const stored = session.store.loadProposal(proposalId(proposalIdValue));
    expect(stored).toMatchObject({
      id: proposalIdValue,
      name: 'Spring plan',
      rationale: null,
      status: 'draft',
      accepted: null,
      board: { id: boardId },
    });
    expect(senderBoards.proposals).toEqual(session.store.listProposals());

    const acceptedPending = senderInbox.next();
    const acceptedBoardsPending = senderInbox.next();
    const watcherAcceptedPending = watcherInbox.next();
    send(sender, {
      type: 'setProposalStatus',
      requestId: 'accept-source',
      proposalId: proposalIdValue,
      status: 'accepted',
    });
    expect(asRecord(await acceptedPending)).toEqual({
      type: 'statusChanged',
      requestId: 'accept-source',
      proposalId: proposalIdValue,
      status: 'accepted',
    });
    expect(asRecord(await acceptedBoardsPending).type).toBe('boards');
    expect(asRecord(await watcherAcceptedPending).type).toBe('boards');
    expect(session.store.loadProposal(proposalId(proposalIdValue))?.status).toBe('accepted');

    const copyPending = senderInbox.next();
    const copyBoardsPending = senderInbox.next();
    const watcherCopyPending = watcherInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'duplicate-accepted',
      name: 'Copy of accepted',
      rationale: null,
      source: { kind: 'proposal', proposalId: proposalIdValue },
    });
    const copyMessage = asRecord(await copyPending);
    expect(copyMessage).toMatchObject({ type: 'proposalCreated', requestId: 'duplicate-accepted' });
    const copyId = requiredString(copyMessage, 'proposalId');
    expect(asRecord(await copyBoardsPending).type).toBe('boards');
    expect(asRecord(await watcherCopyPending).type).toBe('boards');
    const copy = session.store.loadProposal(proposalId(copyId));
    expect(copy?.status).toBe('draft');
    expect(copy?.accepted).toBeNull();
    expect(session.store.loadProposal(proposalId(proposalIdValue))?.status).toBe('accepted');

    const before = session.store.listProposals().length;
    const tooLong = senderInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'too-long',
      name: 'a'.repeat(81),
      rationale: 'b'.repeat(501),
      source: { kind: 'current' },
    });
    expectRejected(asRecord(await tooLong), 'too-long', 'bad_request');
    const blank = senderInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'blank-name',
      name: '   ',
      rationale: null,
      source: { kind: 'current' },
    });
    expectRejected(asRecord(await blank), 'blank-name', 'bad_request');
    const extra = senderInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'extra-key',
      name: 'Fine',
      rationale: null,
      source: { kind: 'current' },
      extra: true,
    });
    expectRejected(asRecord(await extra), 'extra-key', 'bad_request');
    expect(session.store.listProposals()).toHaveLength(before);
  });

  it('duplicate of a proposal with approvals has none', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ward = session.store.loadWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const board = requireBoard(session.store, summary.boardId);
    const chorister = vacantPosition(board, 'Chorister');
    const from = positionHeldBy(board, cy.id);

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, summary.boardId);

    const placed = inbox.next();
    ws.send(
      opMessage({
        requestId: 'place-cy',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: cy.id, from, to: chorister.id },
      }),
    );
    expect(asRecord(await placed).type).toBe('committed');

    const approved = inbox.next();
    ws.send(
      opMessage({
        requestId: 'approve-cy',
        boardId: summary.boardId,
        baseVersion: 1,
        kind: 'approvePlacement',
        request: { memberId: cy.id, positionId: chorister.id },
      }),
    );
    expect(asRecord(await approved).type).toBe('committed');
    const original = session.store.loadProposal(summary.id);
    expect(original?.board.approvals).toHaveLength(1);
    expect(original?.board.placements[chorister.id]).toBe(cy.id);

    const copyPending = inbox.next();
    const boardsPending = inbox.next();
    send(ws, {
      type: 'createProposal',
      requestId: 'duplicate-approved',
      name: 'Copy',
      rationale: null,
      source: { kind: 'proposal', proposalId: summary.id },
    });
    const copyMessage = asRecord(await copyPending);
    expect(copyMessage.type).toBe('proposalCreated');
    expect(asRecord(await boardsPending).type).toBe('boards');
    const copy = session.store.loadProposal(proposalId(requiredString(copyMessage, 'proposalId')));
    expect(copy?.status).toBe('draft');
    expect(copy?.board.approvals).toEqual([]);
    expect(copy?.board.placements[chorister.id]).toBe(cy.id);
    expect(session.store.loadProposal(summary.id)?.board.approvals).toHaveLength(1);
  });

  it('accept: statusChanged to sender, proposalChanged to subscribers only, boards to all; then op on it → not_editable', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const sender = await openSocket(session);
    const senderInbox = new Inbox(sender);
    await subscribe(sender, senderInbox, summary.boardId);
    const watcher = await openSocket(session);
    const watcherInbox = new Inbox(watcher);

    const statusPending = senderInbox.next();
    const changedPending = senderInbox.next();
    const boardsPending = senderInbox.next();
    const watcherPending = watcherInbox.next();
    send(sender, {
      type: 'setProposalStatus',
      requestId: 'accept-1',
      proposalId: summary.id,
      status: 'accepted',
    });

    expect(asRecord(await statusPending)).toEqual({
      type: 'statusChanged',
      requestId: 'accept-1',
      proposalId: summary.id,
      status: 'accepted',
    });
    const changed = asRecord(await changedPending);
    expect(changed).toMatchObject({ type: 'proposalChanged', boardId: summary.boardId });
    const changedProposal = changed.proposal;
    if (typeof changedProposal !== 'object' || changedProposal === null || Array.isArray(changedProposal)) {
      throw new Error('proposalChanged is missing proposal');
    }
    expect(changedProposal).toMatchObject({
      id: summary.id,
      status: 'accepted',
      accepted: { byLogin: ADMIN.login, at: FIXED_TIME, summary: [] },
    });
    const boards = asRecord(await boardsPending);
    expect(boards.type).toBe('boards');
    expect(asRecord(await watcherPending)).toEqual(boards);
    const watcherFollow = watcherInbox.next();
    send(watcher, { type: 'listBoards' });
    expect(asRecord(await watcherFollow)).toEqual(boards);

    const stored = session.store.loadProposal(summary.id);
    expect(stored?.status).toBe('accepted');
    expect(stored?.accepted?.summary).toBe('[]');
    expect(stored?.board.version).toBe(0);

    const ward = session.store.loadWard();
    const mover = memberNamed(ward, 'Liv Example');
    const chorister = vacantPosition(requireBoard(session.store, summary.boardId), 'Chorister');
    const before = session.store.loadProposal(summary.id);
    const rejectedPending = senderInbox.next();
    sender.send(
      opMessage({
        requestId: 'edit-accepted',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: mover.id, from: null, to: chorister.id },
      }),
    );
    const rejected = asRecord(await rejectedPending);
    expect(rejected.type).toBe('rejected');
    expect(rejected.code).toBe('not_editable');
    expect(session.store.loadProposal(summary.id)).toEqual(before);
    expect(session.store.loadBoard(summary.boardId)?.version).toBe(0);
  });

  it('accept refused with removed_items / unapproved_placements and status unchanged', async () => {
    await refusedAccept(seedRemovedMember, 'removed_items', '1 removed member');
    await refusedAccept(seedRemovedPosition, 'removed_items', '1 removed position');

    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ward = session.store.loadWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    const board = requireBoard(session.store, summary.boardId);
    const chorister = vacantPosition(board, 'Chorister');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, summary.boardId);
    const placed = inbox.next();
    ws.send(
      opMessage({
        requestId: 'place-cy',
        boardId: summary.boardId,
        baseVersion: board.version,
        kind: 'placeInPosition',
        request: { memberId: cy.id, from: positionHeldBy(board, cy.id), to: chorister.id },
      }),
    );
    expect(asRecord(await placed).type).toBe('committed');
    const before = session.store.loadProposal(summary.id);
    send(ws, { type: 'setProposalStatus', requestId: 'refuse-approval', proposalId: summary.id, status: 'accepted' });
    const rejected = await nextRecord(inbox);
    expectRejected(rejected, 'refuse-approval', 'unapproved_placements');
    expect(rejected.message).toBe('1 unapproved placement');
    expect(session.store.loadProposal(summary.id)).toEqual(before);
  });

  it('frozen summary does not change when a member is renamed in the ward while Accepted; reopen + re-accept regenerates it', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, summary.boardId);
    const board = requireBoard(session.store, summary.boardId);
    const clerk = occupiedPosition(board, 'Ward Clerk');
    expect(memberNamed(session.store.loadWard(), 'Dora Placeholder').id).toBe(clerk.memberId);

    const released = inbox.next();
    ws.send(
      opMessage({
        requestId: 'release-dora',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'releaseCalling',
        request: { memberId: clerk.memberId, positionId: clerk.positionId },
      }),
    );
    expect(asRecord(await released).type).toBe('committed');

    send(ws, { type: 'setProposalStatus', requestId: 'accept-freeze', proposalId: summary.id, status: 'accepted' });
    expect((await nextRecord(inbox)).type).toBe('statusChanged');
    expect((await nextRecord(inbox)).type).toBe('proposalChanged');
    expect((await nextRecord(inbox)).type).toBe('boards');

    send(ws, { type: 'getProposal', requestId: 'read-frozen', proposalId: summary.id });
    const frozenMessage = await nextRecord(inbox);
    expect(frozenMessage.type).toBe('proposalDetail');
    const frozenAccepted = asRecord(asRecord(frozenMessage.proposal).accepted);
    const frozenSummary = frozenAccepted.summary;
    expect(namesIn(frozenSummary)).toContain('Dora Placeholder');

    session.db.prepare('UPDATE members SET name = ? WHERE id = ?').run('Dora Renamed', clerk.memberId);
    expect(session.store.loadWard().members[memberId(clerk.memberId)]?.name).toBe('Dora Renamed');

    send(ws, { type: 'getProposal', requestId: 'read-still-frozen', proposalId: summary.id });
    const stillAccepted = asRecord(asRecord((await nextRecord(inbox)).proposal).accepted);
    expect(stillAccepted.summary).toEqual(frozenSummary);
    expect(namesIn(stillAccepted.summary)).toContain('Dora Placeholder');
    expect(namesIn(stillAccepted.summary)).not.toContain('Dora Renamed');

    send(ws, { type: 'setProposalStatus', requestId: 'reopen', proposalId: summary.id, status: 'draft' });
    expect(asRecord(await inbox.next())).toMatchObject({ type: 'statusChanged', status: 'draft' });
    expect((await nextRecord(inbox)).type).toBe('proposalChanged');
    expect((await nextRecord(inbox)).type).toBe('boards');
    expect(session.store.loadProposal(summary.id)?.accepted).toBeNull();

    send(ws, { type: 'setProposalStatus', requestId: 'reaccept', proposalId: summary.id, status: 'accepted' });
    expect((await nextRecord(inbox)).type).toBe('statusChanged');
    expect((await nextRecord(inbox)).type).toBe('proposalChanged');
    expect((await nextRecord(inbox)).type).toBe('boards');

    send(ws, { type: 'getProposal', requestId: 'read-regenerated', proposalId: summary.id });
    const regeneratedAccepted = asRecord(asRecord((await nextRecord(inbox)).proposal).accepted);
    expect(namesIn(regeneratedAccepted.summary)).toContain('Dora Renamed');
    expect(namesIn(regeneratedAccepted.summary)).not.toContain('Dora Placeholder');
    expect(regeneratedAccepted.summary).not.toEqual(frozenSummary);
  });

  it('getProposal returns byLogin and parsed summary for Accepted, accepted null for Draft', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const draft = session.store.loadProposal(summary.id);
    if (draft === null) throw new Error('missing proposal');

    send(ws, { type: 'getProposal', requestId: 'read-draft', proposalId: summary.id });
    expect(await nextRecord(inbox)).toEqual({
      type: 'proposalDetail',
      requestId: 'read-draft',
      proposal: detailFrom(draft, null),
    });

    await subscribe(ws, inbox, summary.boardId);
    const board = requireBoard(session.store, summary.boardId);
    const clerk = occupiedPosition(board, 'Ward Clerk');
    const released = inbox.next();
    ws.send(
      opMessage({
        requestId: 'release-clerk',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'releaseCalling',
        request: { memberId: clerk.memberId, positionId: clerk.positionId },
      }),
    );
    expect(asRecord(await released).type).toBe('committed');

    send(ws, { type: 'setProposalStatus', requestId: 'accept-detail', proposalId: summary.id, status: 'accepted' });
    expect((await nextRecord(inbox)).type).toBe('statusChanged');
    expect((await nextRecord(inbox)).type).toBe('proposalChanged');
    expect((await nextRecord(inbox)).type).toBe('boards');

    const accepted = session.store.loadProposal(summary.id);
    if (accepted?.accepted === null || accepted === null) throw new Error('expected acceptance');
    send(ws, { type: 'getProposal', requestId: 'read-accepted', proposalId: summary.id });
    expect(await nextRecord(inbox)).toEqual({
      type: 'proposalDetail',
      requestId: 'read-accepted',
      proposal: detailFrom(accepted, {
        byLogin: ADMIN.login,
        at: FIXED_TIME,
        summary: parsedSummary(accepted.accepted.summary),
      }),
    });
    session.db
      .prepare(
        `INSERT INTO users (id, login, display_name, role, created_at, revoked_at)
         VALUES ('former', 'former@example.test', 'Former Editor', 'editor', ?, ?)`,
      )
      .run(FIXED_TIME, FIXED_TIME);
    session.db.prepare('UPDATE boards SET accepted_by = ? WHERE proposal_id = ?').run('former', summary.id);
    send(ws, { type: 'getProposal', requestId: 'read-revoked', proposalId: summary.id });
    const revokedAccepted = asRecord(asRecord((await nextRecord(inbox)).proposal).accepted);
    expect(revokedAccepted.byLogin).toBe('former@example.test');
    expect(revokedAccepted.summary).toEqual(parsedSummary(accepted.accepted.summary));
  });

  it('updateProposal on Accepted → not_editable; no_change on same status; not_found ids', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const sender = await openSocket(session);
    const senderInbox = new Inbox(sender);
    await subscribe(sender, senderInbox, summary.boardId);
    const watcher = await openSocket(session);
    const watcherInbox = new Inbox(watcher);

    const updatedPending = senderInbox.next();
    const changedPending = senderInbox.next();
    const boardsPending = senderInbox.next();
    const watcherPending = watcherInbox.next();
    send(sender, {
      type: 'updateProposal',
      requestId: 'rename-1',
      proposalId: summary.id,
      name: '  Renamed plan  ',
      rationale: '  Because  ',
    });
    expect(asRecord(await updatedPending)).toEqual({
      type: 'proposalUpdated',
      requestId: 'rename-1',
      proposalId: summary.id,
    });
    const changed = asRecord(await changedPending);
    expect(changed).toMatchObject({ type: 'proposalChanged', boardId: summary.boardId });
    expect(asRecord(await boardsPending).type).toBe('boards');
    const watcherBoards = asRecord(await watcherPending);
    expect(watcherBoards.type).toBe('boards');
    const watcherFollow = watcherInbox.next();
    send(watcher, { type: 'listBoards' });
    expect(asRecord(await watcherFollow)).toEqual(watcherBoards);
    expect(session.store.loadProposal(summary.id)).toMatchObject({ name: 'Renamed plan', rationale: 'Because' });

    const sameDraft = senderInbox.next();
    send(sender, { type: 'setProposalStatus', requestId: 'same-draft', proposalId: summary.id, status: 'draft' });
    expectRejected(asRecord(await sameDraft), 'same-draft', 'no_change');
    expect(session.store.loadProposal(summary.id)?.status).toBe('draft');

    send(sender, { type: 'setProposalStatus', requestId: 'accept-2', proposalId: summary.id, status: 'accepted' });
    expect((await nextRecord(senderInbox)).type).toBe('statusChanged');
    expect((await nextRecord(senderInbox)).type).toBe('proposalChanged');
    expect((await nextRecord(senderInbox)).type).toBe('boards');
    expect((await nextRecord(watcherInbox)).type).toBe('boards');
    const accepted = session.store.loadProposal(summary.id);

    const sameAccepted = senderInbox.next();
    send(sender, { type: 'setProposalStatus', requestId: 'same-accepted', proposalId: summary.id, status: 'accepted' });
    expectRejected(asRecord(await sameAccepted), 'same-accepted', 'no_change');
    expect(session.store.loadProposal(summary.id)).toEqual(accepted);

    const locked = senderInbox.next();
    send(sender, {
      type: 'updateProposal',
      requestId: 'rename-locked',
      proposalId: summary.id,
      name: 'Should fail',
      rationale: null,
    });
    expectRejected(asRecord(await locked), 'rename-locked', 'not_editable');
    expect(session.store.loadProposal(summary.id)).toEqual(accepted);

    const missingUpdate = senderInbox.next();
    send(sender, {
      type: 'updateProposal',
      requestId: 'missing-update',
      proposalId: 'missing-proposal',
      name: 'Nope',
      rationale: null,
    });
    expectRejected(asRecord(await missingUpdate), 'missing-update', 'not_found');

    const missingStatus = senderInbox.next();
    send(sender, {
      type: 'setProposalStatus',
      requestId: 'missing-status',
      proposalId: 'missing-proposal',
      status: 'accepted',
    });
    expectRejected(asRecord(await missingStatus), 'missing-status', 'not_found');

    const missingGet = senderInbox.next();
    send(sender, { type: 'getProposal', requestId: 'missing-get', proposalId: 'missing-proposal' });
    expectRejected(asRecord(await missingGet), 'missing-get', 'not_found');

    const missingSource = senderInbox.next();
    send(sender, {
      type: 'createProposal',
      requestId: 'missing-source',
      name: 'Copy',
      rationale: null,
      source: { kind: 'proposal', proposalId: 'missing-proposal' },
    });
    expectRejected(asRecord(await missingSource), 'missing-source', 'not_found');
    expect(session.store.listProposals()).toHaveLength(1);
  });

  it('accepting with no Current is no_current', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const current = session.store.loadCurrent();
    if (current === null) throw new Error('missing current');
    const before = session.store.loadProposal(summary.id);
    session.db.prepare(`UPDATE boards SET kind = 'baseline' WHERE id = ? AND kind = 'current'`).run(current.board.id);
    expect(session.store.loadCurrent()).toBeNull();

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const pending = inbox.next();
    send(ws, { type: 'setProposalStatus', requestId: 'no-current', proposalId: summary.id, status: 'accepted' });
    expectRejected(asRecord(await pending), 'no-current', 'no_current');
    expect(session.store.loadProposal(summary.id)).toEqual(before);
  });

  it('each new message type from a revoked user → error forbidden and close 4403, no state change', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const messages = [
      {
        type: 'createProposal',
        requestId: 'revoked-create',
        name: 'Should not exist',
        rationale: null,
        source: { kind: 'current' },
      },
      {
        type: 'updateProposal',
        requestId: 'revoked-update',
        proposalId: summary.id,
        name: 'Should not rename',
        rationale: 'nope',
      },
      {
        type: 'setProposalStatus',
        requestId: 'revoked-status',
        proposalId: summary.id,
        status: 'accepted',
      },
      { type: 'getProposal', requestId: 'revoked-get', proposalId: summary.id },
    ];

    for (const message of messages) {
      expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
      const ws = await openSocket(session);
      const inbox = new Inbox(ws);
      const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
      if (editor === undefined) throw new Error('missing editor');
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
      const before = snapshotOf(session.store);

      const closed = inbox.closed();
      const pending = inbox.next();
      send(ws, message);

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
      expect(snapshotOf(session.store)).toEqual(before);
    }
  });

  it('Editor (non-admin) may accept and reopen', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
    if (editor === undefined) throw new Error('missing editor');
    expect(editor.role).toBe('editor');

    send(ws, { type: 'setProposalStatus', requestId: 'editor-accept', proposalId: summary.id, status: 'accepted' });
    expect(await nextRecord(inbox)).toEqual({
      type: 'statusChanged',
      requestId: 'editor-accept',
      proposalId: summary.id,
      status: 'accepted',
    });
    expect((await nextRecord(inbox)).type).toBe('boards');
    send(ws, { type: 'getProposal', requestId: 'editor-read', proposalId: summary.id });
    const accepted = await nextRecord(inbox);
    const acceptedProposal = accepted.proposal;
    if (typeof acceptedProposal !== 'object' || acceptedProposal === null || Array.isArray(acceptedProposal)) {
      throw new Error('missing proposal');
    }
    expect(acceptedProposal).toMatchObject({
      status: 'accepted',
      accepted: { byLogin: EDITOR.login, at: FIXED_TIME, summary: [] },
    });

    send(ws, { type: 'setProposalStatus', requestId: 'editor-reopen', proposalId: summary.id, status: 'draft' });
    expect(await nextRecord(inbox)).toEqual({
      type: 'statusChanged',
      requestId: 'editor-reopen',
      proposalId: summary.id,
      status: 'draft',
    });
    expect((await nextRecord(inbox)).type).toBe('boards');
    send(ws, { type: 'getProposal', requestId: 'editor-reopened', proposalId: summary.id });
    const reopened = await nextRecord(inbox);
    expect(reopened.proposal).toMatchObject({ status: 'draft', accepted: null });
    expect(session.store.loadProposal(summary.id)?.status).toBe('draft');
    expect(session.store.loadProposal(summary.id)?.accepted).toBeNull();
  });
});
