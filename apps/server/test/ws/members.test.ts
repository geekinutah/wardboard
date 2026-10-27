import type { DatabaseSync } from 'node:sqlite';
import {
  approvePlacement,
  placeInPosition,
  sequentialIds,
  tagId,
  unapprovedPlacements,
  userId,
  type Board,
  type Member,
  type PositionId,
  type ProposalId,
  type Tag,
  type Ward,
} from '@wardboard/core';
import type { WebSocket } from 'ws';
import { WebSocket as Socket } from 'ws';
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
  openSocket,
  requireBoard,
  seedDraftProposals,
  startAdmin,
  startSession,
  subscribe,
  type Session,
} from './helpers.ts';

afterEach(cleanup);

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function expectRejected(message: Record<string, unknown>, requestId: string, code: string): void {
  expect(message).toMatchObject({ type: 'rejected', requestId, code });
  expect(typeof message.message).toBe('string');
  expect(message.message).not.toBe('');
}

function tagNamed(ward: Ward, name: string): Tag {
  const tag = Object.values(ward.tags).find((item) => item.name === name);
  if (tag === undefined) throw new Error(`missing tag ${name}`);
  return tag;
}

function profileSnapshot(session: Session): unknown {
  return {
    ward: session.store.loadWard(),
    settings: session.store.loadSettings(),
    current: session.store.loadCurrent(),
    proposals: session.store.listProposals().map((item) => session.store.loadProposal(item.id)),
  };
}

function wardMember(message: Record<string, unknown>, id: string): Record<string, unknown> {
  return asRecord(asRecord(asRecord(message.ward).members)[id]);
}

function vacantPositionId(board: Board, title: string): PositionId {
  const assignments = Object.values(board.assignments).filter((item) => item.title === title);
  for (const assignment of assignments) {
    const position = Object.values(board.positions).find(
      (item) => item.assignmentId === assignment.id && !Object.hasOwn(board.placements, item.id),
    );
    if (position !== undefined) return position.id;
  }
  throw new Error(`no vacancy for ${title}`);
}

function suggestAndApprove(store: Store, id: ProposalId, member: Member, approver: string): PositionId {
  const proposal = store.loadProposal(id);
  if (proposal === null) throw new Error(`missing proposal ${id}`);
  const ward = store.loadWard();
  const position = vacantPositionId(proposal.board, 'Chorister');
  const placed = placeInPosition(
    proposal.board,
    { ward, ids: sequentialIds(`place-${proposal.board.id}`) },
    { memberId: member.id, from: null, to: position },
  );
  if (!placed.ok) throw new Error(placed.error.message);
  const committedPlace = store.commitBoard(placed.board, proposal.board.version);
  if (!committedPlace.ok) throw new Error(committedPlace.error.message);
  const approved = approvePlacement(
    committedPlace.value,
    { ward, ids: sequentialIds(`approve-${proposal.board.id}`) },
    {
      baseline: proposal.baseline,
      memberId: member.id,
      positionId: position,
      approvedBy: userId(approver),
      approvedAt: FIXED_TIME,
    },
  );
  if (!approved.ok) throw new Error(approved.error.message);
  const committed = store.commitBoard(approved.board, committedPlace.value.version);
  if (!committed.ok) throw new Error(committed.error.message);
  return position;
}

function clearNeedsApproval(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE members SET needs_approval = 0 WHERE id = ?').run(id);
}

async function openInbox(session: Session): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = await openSocket(session);
  return { ws, inbox: new Inbox(ws) };
}

describe('member profile channel', () => {
  it('updateMember: sender gets memberUpdated; connections subscribed to different boards and unsubscribed ones all receive ward', async () => {
    const session = await startAdmin(seedDraftProposals(2));
    const [first, second] = session.store.listProposals();
    if (first === undefined || second === undefined) throw new Error('missing proposals');
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');

    const sender = await openInbox(session);
    const other = await openInbox(session);
    const idle = await openInbox(session);
    await subscribe(sender.ws, sender.inbox, first.boardId);
    await subscribe(other.ws, other.inbox, second.boardId);

    const senderAck = sender.inbox.next();
    const senderWard = sender.inbox.next();
    const otherWard = other.inbox.next();
    const idleWard = idle.inbox.next();
    send(sender.ws, {
      type: 'updateMember',
      requestId: 'rename-ada',
      memberId: ada.id,
      patch: { name: '  Ada Renamed  ', note: '  Brings the rolls.  ' },
    });

    expect(asRecord(await senderAck)).toEqual({ type: 'memberUpdated', requestId: 'rename-ada' });
    const senderBody = asRecord(await senderWard);
    const otherBody = asRecord(await otherWard);
    const idleBody = asRecord(await idleWard);
    expect(senderBody.type).toBe('ward');
    expect(otherBody.type).toBe('ward');
    expect(idleBody.type).toBe('ward');
    expect(senderBody.ward).toEqual(session.store.loadWard());
    expect(otherBody.ward).toEqual(session.store.loadWard());
    expect(idleBody.ward).toEqual(session.store.loadWard());
    expect(wardMember(senderBody, ada.id).name).toBe('Ada Renamed');
    expect(wardMember(senderBody, ada.id).note).toBe('Brings the rolls.');

    const missing = sender.inbox.next();
    send(sender.ws, {
      type: 'updateMember',
      requestId: 'missing-member',
      memberId: 'missing-member',
      patch: { name: 'Nope' },
    });
    expectRejected(asRecord(await missing), 'missing-member', 'not_found');

    const before = session.store.loadWard();
    const badTag = sender.inbox.next();
    send(sender.ws, {
      type: 'updateMember',
      requestId: 'bad-tag',
      memberId: ada.id,
      patch: { tagIds: ['missing-tag'] },
    });
    expectRejected(asRecord(await badTag), 'bad-tag', 'invalid');
    expect(session.store.loadWard()).toEqual(before);
    expect(sender.ws.readyState).toBe(Socket.OPEN);
  });

  it('edited name appears in the next snapshot of Current and of every proposal', async () => {
    const session = await startAdmin(seedDraftProposals(2));
    const current = session.store.loadCurrent();
    if (current === null) throw new Error('missing current');
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');
    const boardIds = [current.board.id, ...session.store.listProposals().map((item) => item.boardId)];

    const reader = await openInbox(session);
    for (const boardId of boardIds) {
      const snapshot = await subscribe(reader.ws, reader.inbox, boardId);
      expect(wardMember(snapshot, ada.id).name).toBe('Ada Fictional');
    }

    const writer = await openInbox(session);
    const ack = writer.inbox.next();
    const writerWard = writer.inbox.next();
    const readerWard = reader.inbox.next();
    send(writer.ws, {
      type: 'updateMember',
      requestId: 'shared-name',
      memberId: ada.id,
      patch: { name: 'Ada Shared' },
    });
    expect(asRecord(await ack).type).toBe('memberUpdated');
    expect(wardMember(asRecord(await writerWard), ada.id).name).toBe('Ada Shared');
    expect(wardMember(asRecord(await readerWard), ada.id).name).toBe('Ada Shared');

    for (const boardId of boardIds) {
      const snapshot = await subscribe(reader.ws, reader.inbox, boardId);
      expect(wardMember(snapshot, ada.id).name).toBe('Ada Shared');
      const board = asRecord(snapshot.board);
      const placements = asRecord(board.placements);
      expect(Object.values(placements).includes(ada.id)).toBe(true);
    }
    expect(memberNamed(session.store.loadWard(), 'Ada Shared').id).toBe(ada.id);
  });

  it('createTag and renameTag broadcast the ward; duplicate name is invalid', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const sender = await openInbox(session);
    const idle = await openInbox(session);
    await subscribe(sender.ws, sender.inbox, summary.boardId);

    const tooLong = sender.inbox.next();
    send(sender.ws, { type: 'createTag', requestId: 'tag-long', name: ` ${'t'.repeat(41)} ` });
    expectRejected(asRecord(await tooLong), 'tag-long', 'bad_request');
    expect(session.store.loadWard().tags[musical.id]?.name).toBe('Musical');

    const created = sender.inbox.next();
    const senderWard = sender.inbox.next();
    const idleWard = idle.inbox.next();
    send(sender.ws, { type: 'createTag', requestId: 'tag-new', name: `  ${'t'.repeat(40)}  ` });
    const createdBody = asRecord(await created);
    expect(createdBody.type).toBe('tagCreated');
    expect(createdBody.requestId).toBe('tag-new');
    expect(typeof createdBody.tagId).toBe('string');
    const tag = String(createdBody.tagId);
    const senderBody = asRecord(await senderWard);
    const idleBody = asRecord(await idleWard);
    expect(senderBody.ward).toEqual(session.store.loadWard());
    expect(idleBody.ward).toEqual(session.store.loadWard());
    expect(asRecord(asRecord(senderBody.ward).tags)[tag]).toEqual({ id: tag, name: 't'.repeat(40) });

    const duplicate = sender.inbox.next();
    send(sender.ws, { type: 'createTag', requestId: 'tag-dup', name: 'musical' });
    expectRejected(asRecord(await duplicate), 'tag-dup', 'invalid');

    const renamed = sender.inbox.next();
    const renamedWard = sender.inbox.next();
    send(sender.ws, { type: 'renameTag', requestId: 'tag-rename', tagId: tag, name: '  Lake helper  ' });
    expect(asRecord(await renamed)).toEqual({ type: 'memberUpdated', requestId: 'tag-rename' });
    expect(asRecord(asRecord(asRecord(await renamedWard).ward).tags)[tag]).toEqual({
      id: tag,
      name: 'Lake helper',
    });
    expect(session.store.loadWard().tags[tagId(tag)]?.name).toBe('Lake helper');

    const missing = sender.inbox.next();
    send(sender.ws, { type: 'renameTag', requestId: 'tag-missing', tagId: 'missing-tag', name: 'Nope' });
    expectRejected(asRecord(await missing), 'tag-missing', 'not_found');
    expect(session.store.loadWard().tags[musical.id]?.name).toBe('Musical');
  });

  it('profile boundaries: 100 persists, 101 and whitespace and note 281 are bad_request; empty tagIds clears tags', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const ivy = memberNamed(session.store.loadWard(), 'Ivy Notreal');
    expect(ivy.tagIds.length).toBeGreaterThan(0);
    const { ws, inbox } = await openInbox(session);

    const whitespace = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'blank-name',
      memberId: ivy.id,
      patch: { name: '   ' },
    });
    expectRejected(asRecord(await whitespace), 'blank-name', 'bad_request');

    const tooLong = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'name-101',
      memberId: ivy.id,
      patch: { name: 'a'.repeat(101) },
    });
    expectRejected(asRecord(await tooLong), 'name-101', 'bad_request');

    const noteLong = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'note-281',
      memberId: ivy.id,
      patch: { note: 'n'.repeat(281) },
    });
    expectRejected(asRecord(await noteLong), 'note-281', 'bad_request');
    expect(session.store.loadWard().members[ivy.id]).toEqual(ivy);

    const accepted = inbox.next();
    const wardMessage = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'boundaries',
      memberId: ivy.id,
      patch: { name: 'a'.repeat(100), note: 'n'.repeat(280), tagIds: [] },
    });
    expect(asRecord(await accepted)).toEqual({ type: 'memberUpdated', requestId: 'boundaries' });
    expect(wardMember(asRecord(await wardMessage), ivy.id)).toMatchObject({
      name: 'a'.repeat(100),
      note: 'n'.repeat(280),
      tagIds: [],
    });
    expect(session.store.loadWard().members[ivy.id]).toMatchObject({
      name: 'a'.repeat(100),
      note: 'n'.repeat(280),
      tagIds: [],
    });
  });

  it('Editor setNeedsApproval → rejected forbidden, connection open, flag unchanged', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
    const cy = memberNamed(session.store.loadWard(), 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const { ws, inbox } = await openInbox(session);
    const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
    expect(editor?.role).toBe('editor');

    const pending = inbox.next();
    send(ws, { type: 'setNeedsApproval', requestId: 'editor-flag', memberId: cy.id, value: false });
    expectRejected(asRecord(await pending), 'editor-flag', 'forbidden');
    expect(ws.readyState).toBe(Socket.OPEN);
    expect(session.store.loadWard().members[cy.id]?.needsApproval).toBe(true);

    const settings = inbox.next();
    send(ws, { type: 'getSettings', requestId: 'editor-settings' });
    expect(asRecord(await settings)).toEqual({
      type: 'settings',
      requestId: 'editor-settings',
      showNeedsApproval: false,
    });

    const renamed = inbox.next();
    const wardMessage = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'editor-rename',
      memberId: cy.id,
      patch: { note: 'Editor note' },
    });
    expect(asRecord(await renamed)).toEqual({ type: 'memberUpdated', requestId: 'editor-rename' });
    expect(wardMember(asRecord(await wardMessage), cy.id).note).toBe('Editor note');
    expect(session.store.loadWard().members[cy.id]?.needsApproval).toBe(true);
    expect(ws.readyState).toBe(Socket.OPEN);
  });

  it('Editor setShowNeedsApproval → rejected forbidden, setting unchanged', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
    session.db.prepare(`INSERT INTO settings (key, value) VALUES ('showNeedsApproval', 'true')`).run();
    expect(session.store.loadSettings()).toEqual({ showNeedsApproval: true });
    const { ws, inbox } = await openInbox(session);

    const pending = inbox.next();
    send(ws, { type: 'setShowNeedsApproval', requestId: 'editor-show', value: false });
    expectRejected(asRecord(await pending), 'editor-show', 'forbidden');
    expect(ws.readyState).toBe(Socket.OPEN);
    expect(session.store.loadSettings()).toEqual({ showNeedsApproval: true });

    const settings = inbox.next();
    send(ws, { type: 'getSettings', requestId: 'editor-read-show' });
    expect(asRecord(await settings)).toEqual({
      type: 'settings',
      requestId: 'editor-read-show',
      showNeedsApproval: true,
    });
    expect(ws.readyState).toBe(Socket.OPEN);
  });

  it('Admin demoted to Editor mid-connection is refused setNeedsApproval', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');
    expect(ada.needsApproval).toBe(false);
    const { ws, inbox } = await openInbox(session);
    session.db
      .prepare(
        `INSERT INTO users (id, login, display_name, role, created_at)
         VALUES ('admin-2', 'second-admin@example.test', 'Second Admin', 'admin', ?)`,
      )
      .run(FIXED_TIME);
    expect(session.access.setRole(admin.id, admin.id, 'editor').ok).toBe(true);

    const pending = inbox.next();
    send(ws, { type: 'setNeedsApproval', requestId: 'demoted', memberId: ada.id, value: true });
    expectRejected(asRecord(await pending), 'demoted', 'forbidden');
    expect(ws.readyState).toBe(Socket.OPEN);
    expect(session.store.loadWard().members[ada.id]?.needsApproval).toBe(false);

    const settings = inbox.next();
    send(ws, { type: 'getSettings', requestId: 'still-open' });
    expect(asRecord(await settings)).toEqual({
      type: 'settings',
      requestId: 'still-open',
      showNeedsApproval: false,
    });
  });

  it('Admin setNeedsApproval(true) with an existing approval: committed goes to that board\'s subscribers, ward to all, and unapprovedPlacements now lists the placement', async () => {
    const session = await startAdmin(seedDraftProposals(2));
    const [changed, otherBoard] = session.store.listProposals();
    if (changed === undefined || otherBoard === undefined) throw new Error('missing proposals');
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const cy = memberNamed(session.store.loadWard(), 'Cy Mockup');
    const positionId = suggestAndApprove(session.store, changed.id, cy, admin.id);
    clearNeedsApproval(session.db, cy.id);
    expect(session.store.loadWard().members[cy.id]?.needsApproval).toBe(false);
    const before = requireBoard(session.store, changed.boardId);
    expect(before.approvals).toEqual([
      { memberId: cy.id, positionId, approvedBy: admin.id, approvedAt: FIXED_TIME },
    ]);
    const otherBefore = requireBoard(session.store, otherBoard.boardId);

    const sender = await openInbox(session);
    const peer = await openInbox(session);
    const other = await openInbox(session);
    const idle = await openInbox(session);
    await subscribe(sender.ws, sender.inbox, changed.boardId);
    await subscribe(peer.ws, peer.inbox, changed.boardId);
    await subscribe(other.ws, other.inbox, otherBoard.boardId);

    const senderAck = sender.inbox.next();
    const senderWard = sender.inbox.next();
    const senderCommitted = sender.inbox.next();
    const peerWard = peer.inbox.next();
    const peerCommitted = peer.inbox.next();
    const otherWard = other.inbox.next();
    const idleWard = idle.inbox.next();
    send(sender.ws, {
      type: 'setNeedsApproval',
      requestId: 'flag-cy',
      memberId: cy.id,
      value: true,
    });

    expect(asRecord(await senderAck)).toEqual({ type: 'memberUpdated', requestId: 'flag-cy' });
    for (const body of [await senderWard, await peerWard, await otherWard, await idleWard]) {
      const message = asRecord(body);
      expect(message.type).toBe('ward');
      expect(message.ward).toEqual(session.store.loadWard());
      expect(wardMember(message, cy.id).needsApproval).toBe(true);
    }
    for (const body of [await senderCommitted, await peerCommitted]) {
      const message = asRecord(body);
      expect(message).toMatchObject({
        type: 'committed',
        boardId: changed.boardId,
        version: before.version + 1,
        requestId: 'flag-cy',
        by: ADMIN.login,
      });
      expect(asRecord(message.board).approvals).toEqual([]);
      expect(asRecord(asRecord(message.board).placements)[positionId]).toBe(cy.id);
    }

    const otherFollow = other.inbox.next();
    send(other.ws, { type: 'listBoards' });
    expect(asRecord(await otherFollow).type).toBe('boards');

    const idleFollow = idle.inbox.next();
    send(idle.ws, { type: 'listBoards' });
    expect(asRecord(await idleFollow).type).toBe('boards');

    const proposal = session.store.loadProposal(changed.id);
    if (proposal === null) throw new Error('missing changed proposal');
    expect(unapprovedPlacements(proposal, session.store.loadWard())).toEqual([
      { memberId: cy.id, positionId, approval: null },
    ]);
    expect(requireBoard(session.store, otherBoard.boardId)).toEqual(otherBefore);
    expect(requireBoard(session.store, changed.boardId).version).toBe(before.version + 1);

    const repeat = sender.inbox.next();
    send(sender.ws, {
      type: 'setNeedsApproval',
      requestId: 'flag-again',
      memberId: cy.id,
      value: true,
    });
    const repeated = asRecord(await repeat);
    expectRejected(repeated, 'flag-again', 'invalid');
    expect(repeated.message).toBe('no change');
    expect(requireBoard(session.store, changed.boardId).version).toBe(before.version + 1);
  });

  it('setShowNeedsApproval broadcasts settings to all; getSettings returns it', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const sender = await openInbox(session);
    const other = await openInbox(session);
    await subscribe(other.ws, other.inbox, summary.boardId);

    const before = sender.inbox.next();
    send(sender.ws, { type: 'getSettings', requestId: 'before' });
    expect(asRecord(await before)).toEqual({
      type: 'settings',
      requestId: 'before',
      showNeedsApproval: false,
    });

    const senderSettings = sender.inbox.next();
    const otherSettings = other.inbox.next();
    send(sender.ws, { type: 'setShowNeedsApproval', requestId: 'show-on', value: true });
    expect(asRecord(await senderSettings)).toEqual({
      type: 'settings',
      requestId: '',
      showNeedsApproval: true,
    });
    expect(asRecord(await otherSettings)).toEqual({
      type: 'settings',
      requestId: '',
      showNeedsApproval: true,
    });
    expect(session.store.loadSettings()).toEqual({ showNeedsApproval: true });

    const after = sender.inbox.next();
    send(sender.ws, { type: 'getSettings', requestId: 'after' });
    expect(asRecord(await after)).toEqual({
      type: 'settings',
      requestId: 'after',
      showNeedsApproval: true,
    });

    const otherRead = other.inbox.next();
    send(other.ws, { type: 'getSettings', requestId: 'other' });
    expect(asRecord(await otherRead)).toEqual({
      type: 'settings',
      requestId: 'other',
      showNeedsApproval: true,
    });
  });

  it('each new message type from a revoked user → error forbidden and close 4403, no state change', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const cy = memberNamed(session.store.loadWard(), 'Cy Mockup');
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const messages = [
      { type: 'updateMember', requestId: 'revoked-update', memberId: cy.id, patch: { name: 'Hacked' } },
      { type: 'createTag', requestId: 'revoked-tag', name: 'Hacked Tag' },
      { type: 'renameTag', requestId: 'revoked-rename', tagId: musical.id, name: 'Hacked' },
      { type: 'setNeedsApproval', requestId: 'revoked-flag', memberId: cy.id, value: false },
      { type: 'getSettings', requestId: 'revoked-settings' },
      { type: 'setShowNeedsApproval', requestId: 'revoked-show', value: true },
    ];

    for (const message of messages) {
      expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
      const { ws, inbox } = await openInbox(session);
      const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
      if (editor === undefined) throw new Error('missing editor');
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
      const before = profileSnapshot(session);

      const closed = inbox.closed();
      const pending = inbox.next();
      send(ws, message);

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
      expect(profileSnapshot(session)).toEqual(before);
    }
  });

  it('bad_request for extra keys on each message type', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const cy = memberNamed(session.store.loadWard(), 'Cy Mockup');
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const messages = [
      {
        type: 'updateMember',
        requestId: 'bad-update',
        memberId: cy.id,
        patch: { name: 'Should Not Apply' },
        extra: true,
      },
      { type: 'createTag', requestId: 'bad-tag', name: 'Should Not Exist', extra: true },
      { type: 'renameTag', requestId: 'bad-rename', tagId: musical.id, name: 'Should Not Rename', extra: true },
      { type: 'setNeedsApproval', requestId: 'bad-flag', memberId: cy.id, value: false, extra: true },
      { type: 'getSettings', requestId: 'bad-settings', extra: true },
      { type: 'setShowNeedsApproval', requestId: 'bad-show', value: true, extra: true },
    ];
    const { ws, inbox } = await openInbox(session);
    const before = profileSnapshot(session);

    for (const message of messages) {
      const pending = inbox.next();
      send(ws, message);
      expectRejected(asRecord(await pending), message.requestId, 'bad_request');
    }

    expect(profileSnapshot(session)).toEqual(before);
    expect(ws.readyState).toBe(Socket.OPEN);
    expect(session.store.loadWard().members[cy.id]?.name).toBe('Cy Mockup');
    expect(session.store.loadSettings()).toEqual({ showNeedsApproval: false });
  });
});
