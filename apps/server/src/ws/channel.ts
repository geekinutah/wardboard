import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  boardId,
  proposalId,
  userId,
  type Board,
  type BoardId,
  type Proposal,
  type ProposalId,
} from '@wardboard/core';
import type { Access, User } from '../access/index.ts';
import type { Identity } from '../identity/index.ts';
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

  function dispatch(connection: Connection, parsed: unknown): void {
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
    dispatch(connection, parsed);
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
    terminate() {
      for (const socket of [...wss.clients]) {
        socket.terminate();
      }
    },
  };
}
