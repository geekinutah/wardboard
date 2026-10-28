import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  boardId,
  memberId,
  proposalId,
  tagId,
  userId,
  type Board,
  type BoardId,
  type Proposal,
  type ProposalId,
  type TagId,
  type Ward,
} from '@wardboard/core';
import type { Access, User } from '../access/index.ts';
import type { Identity } from '../identity/index.ts';
import { parseMemberPatch, parseTagName, type MemberProfilePatch } from '../members/index.ts';
import {
  checkAcceptance,
  freezeSummary,
  toProposalDetail,
  validateMeta,
  type ProposalDetail,
} from '../proposals/index.ts';
import type { Store } from '../store/index.ts';
import { prepareOperation } from './operations.ts';

const MAX_PAYLOAD = 262144;

type Connection = {
  ws: WebSocket;
  user: User;
  identity: Identity;
  subscription: BoardId | null;
  open: boolean;
};

export type OperationChannel = {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    user: User,
    identity: Identity,
  ): void;
  /** Close every open socket. The server keeps accepting new connections. */
  closeAll(code: number): void;
  terminate(): void;
};

type ProposalView = {
  id: Proposal['id'];
  name: string;
  status: Proposal['status'];
  rationale: string | null;
  baselineBoardId: Board['id'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function sendJson(ws: WebSocket, message: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function versionOf(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function echoRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return '';
  return value;
}

function boundedRequestId(value: unknown): value is string {
  return nonEmpty(value) && value.length <= 64;
}

function isProposalStatus(value: unknown): value is 'accepted' | 'draft' {
  return value === 'accepted' || value === 'draft';
}

function proposalSource(value: unknown): { kind: 'current' } | { kind: 'proposal'; id: ProposalId } | null {
  if (!isRecord(value)) return null;
  if (exact(value, ['kind']) && value.kind === 'current') return { kind: 'current' };
  if (exact(value, ['kind', 'proposalId']) && value.kind === 'proposal' && nonEmpty(value.proposalId)) {
    return { kind: 'proposal', id: proposalId(value.proposalId) };
  }
  return null;
}

function clientCode(code: string): string {
  return code === 'invalid' ? 'bad_request' : code;
}

export function createOperationChannel(deps: {
  store: Store;
  access: Access;
  clock: () => Date;
  ids: () => string;
}): OperationChannel {
  const { store, access, clock, ids } = deps;
  const connections = new Set<Connection>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  wss.on('error', () => undefined);

  function workingProposal(id: BoardId): Proposal | null {
    for (const summary of store.listProposals()) {
      if (summary.boardId !== id) continue;
      const proposal = store.loadProposal(summary.id);
      if (proposal === null || proposal.board.id !== id) return null;
      return proposal;
    }
    return null;
  }

  function proposalView(id: BoardId): ProposalView | null {
    const proposal = workingProposal(id);
    if (proposal === null) return null;
    return {
      id: proposal.id,
      name: proposal.name,
      status: proposal.status,
      rationale: proposal.rationale,
      baselineBoardId: proposal.baseline.id,
    };
  }

  function broadcast(board: Board, requestId: string, login: string): void {
    const payload = JSON.stringify({
      type: 'committed',
      boardId: board.id,
      version: board.version,
      board,
      requestId,
      by: login,
    });
    for (const connection of connections) {
      if (connection.subscription === board.id && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(payload);
      }
    }
  }

  function boardsMessage(): {
    type: 'boards';
    current: null | { boardId: Board['id']; version: number; importVersion: string; importedAt: string };
    proposals: ReturnType<Store['listProposals']>;
  } {
    const current = store.loadCurrent();
    return {
      type: 'boards',
      current:
        current === null
          ? null
          : {
              boardId: current.board.id,
              version: current.board.version,
              importVersion: current.importVersion,
              importedAt: current.importedAt,
            },
      proposals: store.listProposals(),
    };
  }

  function broadcastBoards(): void {
    const payload = JSON.stringify(boardsMessage());
    for (const connection of connections) {
      if (connection.open && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(payload);
      }
    }
  }

  function broadcastOpen(payload: string): void {
    for (const connection of connections) {
      if (connection.open && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(payload);
      }
    }
  }

  function broadcastWard(ward: Ward): void {
    broadcastOpen(JSON.stringify({ type: 'ward', ward }));
  }

  function broadcastSettings(showNeedsApproval: boolean): void {
    broadcastOpen(JSON.stringify({ type: 'settings', requestId: '', showNeedsApproval }));
  }

  function broadcastProposal(id: BoardId, detail: ProposalDetail): void {
    const payload = JSON.stringify({ type: 'proposalChanged', boardId: id, proposal: detail });
    for (const connection of connections) {
      if (connection.open && connection.subscription === id && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(payload);
      }
    }
  }

  function publishProposal(proposal: Proposal): void {
    broadcastProposal(proposal.board.id, toProposalDetail(proposal, access.listUsers()));
    broadcastBoards();
  }

  function listBoards(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type'])) {
      sendJson(connection.ws, { type: 'error', code: 'bad_request' });
      return;
    }
    sendJson(connection.ws, boardsMessage());
  }

  function subscribe(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'boardId']) || !nonEmpty(message.boardId)) {
      sendJson(connection.ws, { type: 'error', code: 'bad_request' });
      return;
    }
    const id = boardId(message.boardId);
    const board = store.loadBoard(id);
    if (board === null) {
      sendJson(connection.ws, { type: 'error', code: 'not_found', boardId: message.boardId });
      return;
    }
    connection.subscription = id;
    sendJson(connection.ws, {
      type: 'snapshot',
      boardId: board.id,
      version: board.version,
      board,
      ward: store.loadWard(),
      proposal: proposalView(id),
    });
  }

  function reject(
    ws: WebSocket,
    requestId: string,
    code: string,
    message: string,
    currentVersion?: number,
  ): void {
    const body: Record<string, unknown> = { type: 'rejected', requestId, code, message };
    if (currentVersion !== undefined) body.currentVersion = currentVersion;
    sendJson(ws, body);
  }

  function operate(connection: Connection, message: Record<string, unknown>): void {
    const echoed = echoRequestId(message.requestId);
    const fail = (code: string, text: string, currentVersion?: number): void => {
      reject(connection.ws, echoed, code, text, currentVersion);
    };

    if (!exact(message, ['type', 'requestId', 'boardId', 'baseVersion', 'op'])) {
      fail('bad_request', 'op must have requestId, boardId, baseVersion, and op');
      return;
    }
    if (!nonEmpty(message.requestId) || message.requestId.length > 64) {
      fail('bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.boardId)) {
      fail('bad_request', 'boardId must be a non-empty string');
      return;
    }
    if (!versionOf(message.baseVersion)) {
      fail('bad_request', 'baseVersion must be an integer greater than or equal to 0');
      return;
    }
    if (!isRecord(message.op) || !exact(message.op, ['kind', 'request'])) {
      fail('bad_request', 'op must have kind and request');
      return;
    }
    if (!nonEmpty(message.op.kind)) {
      fail('bad_request', 'op.kind must be a non-empty string');
      return;
    }
    if (!isRecord(message.op.request)) {
      fail('bad_request', 'op.request must be an object');
      return;
    }

    const requestId = message.requestId;
    const target = message.boardId;
    const baseVersion = message.baseVersion;
    const kind = message.op.kind;
    const request = message.op.request;
    const prepared = prepareOperation(kind, request);
    if (!prepared.ok) {
      fail(prepared.code, prepared.message);
      return;
    }

    const targetId = boardId(target);
    if (connection.subscription !== targetId) {
      fail('not_subscribed', `not subscribed to board ${target}`);
      return;
    }

    const loaded = store.loadBoard(targetId);
    if (loaded === null) {
      fail('not_found', `board ${target} does not exist`);
      return;
    }
    if (loaded.kind !== 'proposal') {
      fail('not_editable', `board ${loaded.id} is ${loaded.kind} and cannot be edited`);
      return;
    }
    const proposal = workingProposal(targetId);
    if (proposal === null) {
      fail('not_found', `board ${target} does not exist`);
      return;
    }
    if (proposal.status === 'accepted') {
      fail('not_editable', 'accepted proposals cannot be edited');
      return;
    }
    if (loaded.version !== baseVersion) {
      fail(
        'stale',
        `board ${loaded.id} version is ${String(loaded.version)}, expected ${String(baseVersion)}`,
        loaded.version,
      );
      return;
    }

    // Version check through commit stays synchronous so one board cannot fork.
    const outcome = prepared.apply(loaded, {
      ward: store.loadWard(),
      ids,
      actorId: connection.user.id,
      approvedAt: clock().toISOString(),
      baseline: proposal.baseline,
    });
    if (!outcome.ok) {
      fail(outcome.code, outcome.message);
      return;
    }
    const committed = store.commitBoard(outcome.board, baseVersion);
    if (!committed.ok) {
      if (committed.error.code === 'stale') {
        fail('stale', committed.error.message, committed.error.currentVersion);
      } else {
        fail(committed.error.code, committed.error.message);
      }
      return;
    }
    broadcast(committed.value, requestId, connection.user.login);
  }

  function refuse(connection: Connection, message: Record<string, unknown>, code: string, text: string): void {
    reject(connection.ws, echoRequestId(message.requestId), code, text);
  }

  function createProposal(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'name', 'rationale', 'source'])) {
      refuse(connection, message, 'bad_request', 'createProposal must have requestId, name, rationale, and source');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    const meta = validateMeta({ name: message.name, rationale: message.rationale });
    if (!meta.ok) {
      refuse(
        connection,
        message,
        'bad_request',
        'name must be 1 to 80 characters and rationale must be null or at most 500 characters',
      );
      return;
    }
    const source = proposalSource(message.source);
    if (source === null) {
      refuse(connection, message, 'bad_request', 'source must be current or an existing proposal');
      return;
    }
    const created = store.createProposal({ name: meta.name, rationale: meta.rationale, source }, ids);
    if (!created.ok) {
      refuse(connection, message, clientCode(created.error.code), created.error.message);
      return;
    }
    sendJson(connection.ws, {
      type: 'proposalCreated',
      requestId: message.requestId,
      proposalId: created.value.id,
      boardId: created.value.board.id,
    });
    broadcastBoards();
  }

  function updateProposal(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'proposalId', 'name', 'rationale'])) {
      refuse(connection, message, 'bad_request', 'updateProposal must have requestId, proposalId, name, and rationale');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.proposalId)) {
      refuse(connection, message, 'bad_request', 'proposalId must be a non-empty string');
      return;
    }
    const meta = validateMeta({ name: message.name, rationale: message.rationale });
    if (!meta.ok) {
      refuse(
        connection,
        message,
        'bad_request',
        'name must be 1 to 80 characters and rationale must be null or at most 500 characters',
      );
      return;
    }
    const updated = store.updateProposalMeta(proposalId(message.proposalId), {
      name: meta.name,
      rationale: meta.rationale,
    });
    if (!updated.ok) {
      refuse(connection, message, clientCode(updated.error.code), updated.error.message);
      return;
    }
    sendJson(connection.ws, {
      type: 'proposalUpdated',
      requestId: message.requestId,
      proposalId: updated.value.id,
    });
    publishProposal(updated.value);
  }

  function applyStatus(
    connection: Connection,
    proposal: Proposal,
    status: 'accepted' | 'draft',
  ): { ok: true; value: Proposal } | { ok: false; code: string; message: string } {
    if (status === 'draft') {
      const reopened = store.setProposalAcceptance(proposal.id, null);
      if (!reopened.ok) return { ok: false, code: clientCode(reopened.error.code), message: reopened.error.message };
      return reopened;
    }
    const current = store.loadCurrent();
    if (current === null) return { ok: false, code: 'no_current', message: 'no current board' };
    const ward = store.loadWard();
    const eligibility = checkAcceptance(proposal, current.board, ward);
    if (!eligibility.ok) return eligibility;
    // Eligibility and the write stay on the same stack with no await between them.
    const accepted = store.setProposalAcceptance(proposal.id, {
      by: userId(connection.user.id),
      at: clock().toISOString(),
      summary: freezeSummary(proposal, ward),
    });
    if (!accepted.ok) return { ok: false, code: clientCode(accepted.error.code), message: accepted.error.message };
    return accepted;
  }

  function setProposalStatus(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'proposalId', 'status'])) {
      refuse(connection, message, 'bad_request', 'setProposalStatus must have requestId, proposalId, and status');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.proposalId)) {
      refuse(connection, message, 'bad_request', 'proposalId must be a non-empty string');
      return;
    }
    if (!isProposalStatus(message.status)) {
      refuse(connection, message, 'bad_request', 'status must be accepted or draft');
      return;
    }
    const id = proposalId(message.proposalId);
    const proposal = store.loadProposal(id);
    if (proposal === null) {
      refuse(connection, message, 'not_found', `proposal ${id} does not exist`);
      return;
    }
    if (proposal.status === message.status) {
      refuse(connection, message, 'no_change', `proposal ${id} is already ${message.status}`);
      return;
    }
    const written = applyStatus(connection, proposal, message.status);
    if (!written.ok) {
      refuse(connection, message, written.code, written.message);
      return;
    }
    sendJson(connection.ws, {
      type: 'statusChanged',
      requestId: message.requestId,
      proposalId: written.value.id,
      status: written.value.status,
    });
    publishProposal(written.value);
  }

  function getProposal(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'proposalId'])) {
      refuse(connection, message, 'bad_request', 'getProposal must have requestId and proposalId');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.proposalId)) {
      refuse(connection, message, 'bad_request', 'proposalId must be a non-empty string');
      return;
    }
    const proposal = store.loadProposal(proposalId(message.proposalId));
    if (proposal === null) {
      refuse(connection, message, 'not_found', `proposal ${message.proposalId} does not exist`);
      return;
    }
    sendJson(connection.ws, {
      type: 'proposalDetail',
      requestId: message.requestId,
      proposal: toProposalDetail(proposal, access.listUsers()),
    });
  }

  function profilePatch(patch: MemberProfilePatch): {
    name?: string;
    note?: string | null;
    tagIds?: TagId[];
    photoRef?: string;
  } {
    const next: { name?: string; note?: string | null; tagIds?: TagId[]; photoRef?: string } = {};
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.note !== undefined) next.note = patch.note;
    if (patch.tagIds !== undefined) next.tagIds = patch.tagIds.map((id) => tagId(id));
    if (patch.photoRef !== undefined) next.photoRef = patch.photoRef;
    return next;
  }

  function updateMember(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'memberId', 'patch'])) {
      refuse(connection, message, 'bad_request', 'updateMember must have requestId, memberId, and patch');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.memberId)) {
      refuse(connection, message, 'bad_request', 'memberId must be a non-empty string');
      return;
    }
    const patch = parseMemberPatch(message.patch);
    if (!patch.ok) {
      refuse(connection, message, 'bad_request', patch.message);
      return;
    }
    const updated = store.updateMemberProfile(memberId(message.memberId), profilePatch(patch.value));
    if (!updated.ok) {
      refuse(connection, message, updated.error.code, updated.error.message);
      return;
    }
    sendJson(connection.ws, { type: 'memberUpdated', requestId: message.requestId });
    broadcastWard(updated.value);
  }

  function createTag(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'name'])) {
      refuse(connection, message, 'bad_request', 'createTag must have requestId and name');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    const name = parseTagName(message.name);
    if (!name.ok) {
      refuse(connection, message, 'bad_request', name.message);
      return;
    }
    const created = store.createTag(name.value, ids);
    if (!created.ok) {
      refuse(connection, message, created.error.code, created.error.message);
      return;
    }
    sendJson(connection.ws, {
      type: 'tagCreated',
      requestId: message.requestId,
      tagId: created.value.tagId,
    });
    broadcastWard(created.value.ward);
  }

  function renameTag(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'tagId', 'name'])) {
      refuse(connection, message, 'bad_request', 'renameTag must have requestId, tagId, and name');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.tagId)) {
      refuse(connection, message, 'bad_request', 'tagId must be a non-empty string');
      return;
    }
    const name = parseTagName(message.name);
    if (!name.ok) {
      refuse(connection, message, 'bad_request', name.message);
      return;
    }
    const renamed = store.renameTag(tagId(message.tagId), name.value);
    if (!renamed.ok) {
      refuse(connection, message, renamed.error.code, renamed.error.message);
      return;
    }
    sendJson(connection.ws, { type: 'memberUpdated', requestId: message.requestId });
    broadcastWard(renamed.value);
  }

  function tagRequest(
    connection: Connection,
    message: Record<string, unknown>,
    type: string,
  ): { requestId: string; id: TagId } | null {
    if (!exact(message, ['type', 'requestId', 'tagId'])) {
      refuse(connection, message, 'bad_request', `${type} must have requestId and tagId`);
      return null;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return null;
    }
    if (!nonEmpty(message.tagId)) {
      refuse(connection, message, 'bad_request', 'tagId must be a non-empty string');
      return null;
    }
    return { requestId: message.requestId, id: tagId(message.tagId) };
  }

  function deleteTag(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const request = tagRequest(connection, message, 'deleteTag');
    if (request === null) return;
    const { requestId, id } = request;
    const deleted = store.deleteTag(id);
    if (!deleted.ok) {
      refuse(connection, message, clientCode(deleted.error.code), deleted.error.message);
      return;
    }
    sendJson(connection.ws, { type: 'tagDeleted', requestId, tagId: id });
    broadcastWard(deleted.value.ward);
    for (const board of deleted.value.boards) {
      broadcast(board, requestId, actor.login);
    }
    broadcastBoards();
  }

  function getTagUsage(connection: Connection, message: Record<string, unknown>): void {
    const request = tagRequest(connection, message, 'getTagUsage');
    if (request === null) return;
    const { requestId, id } = request;
    const usage = store.tagUsage(id);
    if (!usage.ok) {
      refuse(connection, message, clientCode(usage.error.code), usage.error.message);
      return;
    }
    sendJson(connection.ws, {
      type: 'tagUsage',
      requestId,
      tagId: id,
      members: usage.value.members,
      callingPreferences: usage.value.callingPreferences,
      callingTags: usage.value.callingTags,
    });
  }

  function requireAdmin(connection: Connection, message: Record<string, unknown>, actor: User, action: string): boolean {
    if (actor.role === 'admin') return true;
    refuse(connection, message, 'forbidden', `only an admin can ${action}`);
    return false;
  }

  function setNeedsApproval(connection: Connection, message: Record<string, unknown>, actor: User): void {
    if (!exact(message, ['type', 'requestId', 'memberId', 'value'])) {
      refuse(connection, message, 'bad_request', 'setNeedsApproval must have requestId, memberId, and value');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.memberId)) {
      refuse(connection, message, 'bad_request', 'memberId must be a non-empty string');
      return;
    }
    if (typeof message.value !== 'boolean') {
      refuse(connection, message, 'bad_request', 'value must be a boolean');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'set needs approval')) return;
    const updated = store.setNeedsApproval(memberId(message.memberId), message.value);
    if (!updated.ok) {
      refuse(connection, message, updated.error.code, updated.error.message);
      return;
    }
    sendJson(connection.ws, { type: 'memberUpdated', requestId: message.requestId });
    broadcastWard(updated.value.ward);
    for (const board of updated.value.boards) {
      broadcast(board, message.requestId, actor.login);
    }
  }

  function whoami(connection: Connection, message: Record<string, unknown>, actor: User): void {
    if (!exact(message, ['type', 'requestId'])) {
      refuse(connection, message, 'bad_request', 'whoami must have requestId');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    sendJson(connection.ws, {
      type: 'me',
      requestId: message.requestId,
      user: { login: actor.login, displayName: actor.displayName, role: actor.role },
    });
  }

  function getBoard(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId', 'boardId'])) {
      refuse(connection, message, 'bad_request', 'getBoard must have requestId and boardId');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (!nonEmpty(message.boardId)) {
      refuse(connection, message, 'bad_request', 'boardId must be a non-empty string');
      return;
    }
    const board = store.loadBoard(boardId(message.boardId));
    if (board === null) {
      refuse(connection, message, 'not_found', `board ${message.boardId} does not exist`);
      return;
    }
    sendJson(connection.ws, { type: 'board', requestId: message.requestId, board });
  }

  function getSettings(connection: Connection, message: Record<string, unknown>): void {
    if (!exact(message, ['type', 'requestId'])) {
      refuse(connection, message, 'bad_request', 'getSettings must have requestId');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    const settings = store.loadSettings();
    sendJson(connection.ws, {
      type: 'settings',
      requestId: message.requestId,
      showNeedsApproval: settings.showNeedsApproval,
    });
  }

  function setShowNeedsApproval(connection: Connection, message: Record<string, unknown>, actor: User): void {
    if (!exact(message, ['type', 'requestId', 'value'])) {
      refuse(connection, message, 'bad_request', 'setShowNeedsApproval must have requestId and value');
      return;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return;
    }
    if (typeof message.value !== 'boolean') {
      refuse(connection, message, 'bad_request', 'value must be a boolean');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'change show needs approval')) return;
    store.setShowNeedsApproval(message.value);
    broadcastSettings(store.loadSettings().showNeedsApproval);
  }

  function isRole(value: unknown): value is 'editor' | 'admin' {
    return value === 'editor' || value === 'admin';
  }

  function accessErrorText(code: string): string {
    if (code === 'forbidden') return 'only an admin can manage access';
    if (code === 'not_found') return 'not found';
    if (code === 'invalid_login') return 'invalid login';
    if (code === 'already_user') return 'already a user';
    if (code === 'already_invited') return 'already invited';
    if (code === 'last_admin') return 'cannot change the last admin';
    if (code === 'revoked') return 'already revoked';
    return 'request failed';
  }

  function requestShape(
    connection: Connection,
    message: Record<string, unknown>,
    keys: readonly string[],
    description: string,
  ): string | undefined {
    if (!exact(message, keys)) {
      refuse(connection, message, 'bad_request', description);
      return undefined;
    }
    if (!boundedRequestId(message.requestId)) {
      refuse(connection, message, 'bad_request', 'requestId must be a string of 1 to 64 characters');
      return undefined;
    }
    return message.requestId;
  }

  function rejectAccess(connection: Connection, message: Record<string, unknown>, code: string): void {
    refuse(connection, message, code, accessErrorText(code));
  }

  // Validation, the access write, and the broadcast stay on the same stack with no await between them.
  function broadcastAccess(): void {
    const admins: Connection[] = [];
    for (const candidate of connections) {
      if (!candidate.open || candidate.ws.readyState !== WebSocket.OPEN) continue;
      const resolved = access.resolve(candidate.identity);
      if (!resolved.ok || resolved.user.role !== 'admin') continue;
      admins.push(candidate);
    }
    const frame = {
      type: 'access',
      requestId: '',
      users: access.listUsers(),
      invitations: access.listInvitations(),
    };
    for (const adminConnection of admins) sendJson(adminConnection.ws, frame);
  }

  function closeRevokedUser(userId: string): void {
    const payload = JSON.stringify({ type: 'error', code: 'forbidden' });
    for (const target of [...connections]) {
      if (target.user.id !== userId) continue;
      target.open = false;
      target.subscription = null;
      if (target.ws.readyState !== WebSocket.OPEN) continue;
      target.ws.send(payload, () => {
        target.ws.close(4403);
      });
    }
  }

  function finishAccessChange(connection: Connection, requestId: string, revokedUserId: string | null): void {
    sendJson(connection.ws, { type: 'accessUpdated', requestId });
    broadcastAccess();
    if (revokedUserId !== null) closeRevokedUser(revokedUserId);
  }

  function listAccess(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(connection, message, ['type', 'requestId'], 'listAccess must have requestId');
    if (requestId === undefined) return;
    if (!requireAdmin(connection, message, actor, 'list access')) return;
    sendJson(connection.ws, {
      type: 'access',
      requestId,
      users: access.listUsers(),
      invitations: access.listInvitations(),
    });
  }

  function invite(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(
      connection,
      message,
      ['type', 'requestId', 'login'],
      'invite must have requestId and login',
    );
    if (requestId === undefined) return;
    if (!nonEmpty(message.login)) {
      refuse(connection, message, 'bad_request', 'login must be a non-empty string');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'invite')) return;
    const invited = access.invite(actor.id, message.login);
    if (!invited.ok) {
      rejectAccess(connection, message, invited.code);
      return;
    }
    finishAccessChange(connection, requestId, null);
  }

  function revokeInvitation(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(
      connection,
      message,
      ['type', 'requestId', 'invitationId'],
      'revokeInvitation must have requestId and invitationId',
    );
    if (requestId === undefined) return;
    if (!nonEmpty(message.invitationId)) {
      refuse(connection, message, 'bad_request', 'invitationId must be a non-empty string');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'revoke an invitation')) return;
    const revoked = access.revokeInvitation(actor.id, message.invitationId);
    if (!revoked.ok) {
      rejectAccess(connection, message, revoked.code);
      return;
    }
    finishAccessChange(connection, requestId, null);
  }

  function revokeUser(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(
      connection,
      message,
      ['type', 'requestId', 'userId'],
      'revokeUser must have requestId and userId',
    );
    if (requestId === undefined) return;
    if (!nonEmpty(message.userId)) {
      refuse(connection, message, 'bad_request', 'userId must be a non-empty string');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'revoke a user')) return;
    const revoked = access.revokeUser(actor.id, message.userId);
    if (!revoked.ok) {
      rejectAccess(connection, message, revoked.code);
      return;
    }
    finishAccessChange(connection, requestId, message.userId);
  }

  function setRole(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(
      connection,
      message,
      ['type', 'requestId', 'userId', 'role'],
      'setRole must have requestId, userId, and role',
    );
    if (requestId === undefined) return;
    if (!nonEmpty(message.userId)) {
      refuse(connection, message, 'bad_request', 'userId must be a non-empty string');
      return;
    }
    if (!isRole(message.role)) {
      refuse(connection, message, 'bad_request', 'role must be editor or admin');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'set a role')) return;
    const updated = access.setRole(actor.id, message.userId, message.role);
    if (!updated.ok) {
      rejectAccess(connection, message, updated.code);
      return;
    }
    finishAccessChange(connection, requestId, null);
  }

  function transferAdmin(connection: Connection, message: Record<string, unknown>, actor: User): void {
    const requestId = requestShape(
      connection,
      message,
      ['type', 'requestId', 'toUserId'],
      'transferAdmin must have requestId and toUserId',
    );
    if (requestId === undefined) return;
    if (!nonEmpty(message.toUserId)) {
      refuse(connection, message, 'bad_request', 'toUserId must be a non-empty string');
      return;
    }
    if (!requireAdmin(connection, message, actor, 'transfer admin')) return;
    const transferred = access.transferAdmin(actor.id, message.toUserId);
    if (!transferred.ok) {
      rejectAccess(connection, message, transferred.code);
      return;
    }
    finishAccessChange(connection, requestId, null);
  }

  function dispatch(connection: Connection, parsed: unknown, actor: User): void {
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      sendJson(connection.ws, { type: 'error', code: 'bad_request' });
      return;
    }
    if (parsed.type === 'listBoards') {
      listBoards(connection, parsed);
      return;
    }
    if (parsed.type === 'subscribe') {
      subscribe(connection, parsed);
      return;
    }
    if (parsed.type === 'op') {
      operate(connection, parsed);
      return;
    }
    if (parsed.type === 'createProposal') {
      createProposal(connection, parsed);
      return;
    }
    if (parsed.type === 'updateProposal') {
      updateProposal(connection, parsed);
      return;
    }
    if (parsed.type === 'setProposalStatus') {
      setProposalStatus(connection, parsed);
      return;
    }
    if (parsed.type === 'getProposal') {
      getProposal(connection, parsed);
      return;
    }
    if (parsed.type === 'updateMember') {
      updateMember(connection, parsed);
      return;
    }
    if (parsed.type === 'createTag') {
      createTag(connection, parsed);
      return;
    }
    if (parsed.type === 'renameTag') {
      renameTag(connection, parsed);
      return;
    }
    if (parsed.type === 'deleteTag') {
      deleteTag(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'getTagUsage') {
      getTagUsage(connection, parsed);
      return;
    }
    if (parsed.type === 'setNeedsApproval') {
      setNeedsApproval(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'whoami') {
      whoami(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'getBoard') {
      getBoard(connection, parsed);
      return;
    }
    if (parsed.type === 'getSettings') {
      getSettings(connection, parsed);
      return;
    }
    if (parsed.type === 'setShowNeedsApproval') {
      setShowNeedsApproval(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'listAccess') {
      listAccess(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'invite') {
      invite(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'revokeInvitation') {
      revokeInvitation(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'revokeUser') {
      revokeUser(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'setRole') {
      setRole(connection, parsed, actor);
      return;
    }
    if (parsed.type === 'transferAdmin') {
      transferAdmin(connection, parsed, actor);
      return;
    }
    sendJson(connection.ws, { type: 'error', code: 'bad_request' });
  }

  function onMessage(connection: Connection, data: RawData, isBinary: boolean): void {
    if (!connection.open) return;
    const resolved = access.resolve(connection.identity);
    if (!resolved.ok) {
      connection.open = false;
      connection.subscription = null;
      const payload = JSON.stringify({ type: 'error', code: 'forbidden' });
      connection.ws.send(payload, () => {
        connection.ws.close(4403);
      });
      return;
    }
    if (isBinary) {
      sendJson(connection.ws, { type: 'error', code: 'bad_message' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText(data)) as unknown;
    } catch {
      sendJson(connection.ws, { type: 'error', code: 'bad_message' });
      return;
    }
    dispatch(connection, parsed, resolved.user);
  }

  return {
    handleUpgrade(req, socket, head, user, identity) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => undefined);
        const connection: Connection = { ws, user, identity, subscription: null, open: true };
        connections.add(connection);
        ws.on('close', () => {
          connections.delete(connection);
        });
        ws.on('message', (data, isBinary) => {
          try {
            onMessage(connection, data, isBinary);
          } catch {
            sendJson(ws, { type: 'error', code: 'internal_error' });
          }
        });
      });
    },
    closeAll(code: number): void {
      for (const connection of [...connections]) {
        connection.open = false;
        connection.subscription = null;
        const state = connection.ws.readyState;
        if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
          connection.ws.close(code);
        }
      }
    },
    terminate() {
      for (const socket of [...wss.clients]) {
        socket.terminate();
      }
    },
  };
}
