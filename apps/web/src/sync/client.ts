import { SUMMARY_GROUP_KEYS, type Board, type SummaryGroup, type Ward } from '@wardboard/core';
import type { OpKind, ProposalSummary } from '@wardboard/server';
import type {
  AccessDirectory,
  AccessInvitation,
  AccessUser,
  CurrentInfo,
  Me,
  MemberPatch,
  ProposalDetailView,
  ProposalView,
  RequestResult,
  Settings,
  TagUsage,
} from './protocol.ts';

export type ConnectionStatus = 'connecting' | 'live' | 'offline' | 'forbidden';

export type SyncNotice =
  | { kind: 'rejected'; requestId: string; code: string; message: string }
  | { kind: 'stale'; requestId: string }
  | { kind: 'resynced' };

export type SyncState = {
  status: ConnectionStatus;
  boards: { current: CurrentInfo | null; proposals: readonly ProposalSummary[] } | null;
  subscribedBoardId: string | null;
  board: Board | null;
  ward: Ward | null;
  proposal: ProposalView | null;
  notice: SyncNotice | null;
  me: Me | null;
  settings: Settings | null;
  /** Null until the first `access` frame, and again after disconnect. */
  access: AccessDirectory | null;
};

export type OpOutcome = { ok: true; version: number } | { ok: false; code: string; message: string };

/** Minimal browser WebSocket surface. `ws` in Node satisfies it when handlers are assigned. */
export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type SyncDeps = {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  timers: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  requestIds: () => string;
};

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
const IDLE_MS = 25_000;
export const REPLY_MS = 10_000;
const FORBIDDEN_CLOSE = 4403;
const OFFLINE: OpOutcome = { ok: false, code: 'offline', message: 'offline' };
const REQUEST_OFFLINE: { ok: false; code: string; message: string } = {
  ok: false,
  code: 'offline',
  message: 'offline',
};

type ResultReply =
  | 'proposalCreated'
  | 'memberUpdated'
  | 'settings'
  | 'access'
  | 'accessUpdated'
  | 'tagCreated'
  | 'tagDeleted'
  | 'tagUsage'
  | 'statusChanged'
  | 'proposalDetail';

const BAD_REPLY = (what: string): { ok: false; code: string; message: string } => ({
  ok: false,
  code: 'bad_reply',
  message: `malformed ${what} reply`,
});

type StoredResult = RequestResult<Record<string, unknown>>;

type ResultWaiter = {
  resolve: (result: StoredResult) => void;
  timer: unknown;
  reply: ResultReply;
};

type SnapshotMessage = {
  boardId: string;
  version: number;
  board: Board;
  ward: Ward;
  proposal: ProposalView | null;
};

type CommittedMessage = {
  boardId: string;
  version: number;
  board: Board;
  requestId: string;
  by: string;
};

type RejectedMessage = {
  requestId: string;
  code: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function messageText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return null;
}

function readCurrent(value: unknown): CurrentInfo | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isNonEmpty(value.boardId) || !isVersion(value.version)) return undefined;
  if (typeof value.importVersion !== 'string' || typeof value.importedAt !== 'string') return undefined;
  return {
    boardId: value.boardId as CurrentInfo['boardId'],
    version: value.version,
    importVersion: value.importVersion,
    importedAt: value.importedAt,
  };
}

function readProposalSummary(value: unknown): ProposalSummary | null {
  if (!isRecord(value)) return null;
  if (!isNonEmpty(value.id) || typeof value.name !== 'string') return null;
  if (value.status !== 'draft' && value.status !== 'accepted') return null;
  if (typeof value.tabOrder !== 'number' || !Number.isInteger(value.tabOrder)) return null;
  if (!isNonEmpty(value.boardId) || !isVersion(value.version)) return null;
  if (typeof value.updatedAt !== 'string') return null;
  const acceptedAt = value.acceptedAt === undefined ? null : value.acceptedAt;
  if (acceptedAt !== null && typeof acceptedAt !== 'string') return null;
  return { ...(value as ProposalSummary), acceptedAt };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function readSummaryLines(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (line) =>
        isRecord(line) &&
        typeof line.memberId === 'string' &&
        typeof line.name === 'string' &&
        typeof line.positionId === 'string' &&
        typeof line.text === 'string',
    )
  );
}

function readSummaryGroups(value: unknown): SummaryGroup[] | null {
  if (!Array.isArray(value)) return null;
  for (const group of value) {
    if (!isRecord(group)) return null;
    if (!(SUMMARY_GROUP_KEYS as readonly unknown[]).includes(group.key)) return null;
    if (typeof group.heading !== 'string') return null;
    if (!readSummaryLines(group.callings) || !readSummaryLines(group.releases)) return null;
  }
  return value as SummaryGroup[];
}

function readProposalDetail(value: unknown): ProposalDetailView | null {
  if (!isRecord(value)) return null;
  if (!isNonEmpty(value.id) || typeof value.name !== 'string') return null;
  if (value.status !== 'draft' && value.status !== 'accepted') return null;
  if (!(typeof value.rationale === 'string' || value.rationale === null)) return null;
  if (!isNonEmpty(value.baselineBoardId) || !isNonEmpty(value.boardId)) return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null;
  let accepted: ProposalDetailView['accepted'] = null;
  if (value.accepted !== null) {
    const block = value.accepted;
    if (!isRecord(block) || typeof block.byLogin !== 'string' || typeof block.at !== 'string') return null;
    const summary = readSummaryGroups(block.summary);
    if (summary === null) return null;
    accepted = { byLogin: block.byLogin, at: block.at, summary };
  }
  return {
    id: value.id as ProposalDetailView['id'],
    name: value.name,
    status: value.status,
    rationale: value.rationale,
    baselineBoardId: value.baselineBoardId as ProposalDetailView['baselineBoardId'],
    boardId: value.boardId as ProposalDetailView['boardId'],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    accepted,
  };
}

function readProposalView(value: unknown): ProposalView | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isNonEmpty(value.id) || typeof value.name !== 'string') return undefined;
  if (value.status !== 'draft' && value.status !== 'accepted') return undefined;
  if (!(typeof value.rationale === 'string' || value.rationale === null)) return undefined;
  if (!isNonEmpty(value.baselineBoardId)) return undefined;
  return {
    id: value.id as ProposalView['id'],
    name: value.name,
    status: value.status,
    rationale: value.rationale,
    baselineBoardId: value.baselineBoardId as ProposalView['baselineBoardId'],
  };
}

function readSnapshot(value: Record<string, unknown>): SnapshotMessage | null {
  if (!isNonEmpty(value.boardId) || !isVersion(value.version)) return null;
  if (!isRecord(value.board) || !isRecord(value.ward)) return null;
  const proposal = readProposalView(value.proposal);
  if (proposal === undefined) return null;
  return {
    boardId: value.boardId,
    version: value.version,
    board: value.board as unknown as Board,
    ward: value.ward as unknown as Ward,
    proposal,
  };
}

function readCommitted(value: Record<string, unknown>): CommittedMessage | null {
  if (!isNonEmpty(value.boardId) || !isVersion(value.version) || !isRecord(value.board)) return null;
  if (typeof value.requestId !== 'string' || typeof value.by !== 'string') return null;
  return {
    boardId: value.boardId,
    version: value.version,
    board: value.board as unknown as Board,
    requestId: value.requestId,
    by: value.by,
  };
}

function readMe(value: unknown): Me | null {
  if (!isRecord(value)) return null;
  if (!isNonEmpty(value.login) || !isNonEmpty(value.displayName)) return null;
  if (value.role !== 'editor' && value.role !== 'admin') return null;
  return { login: value.login, displayName: value.displayName, role: value.role };
}

function readRejected(value: Record<string, unknown>): RejectedMessage | null {
  if (typeof value.requestId !== 'string' || typeof value.code !== 'string' || typeof value.message !== 'string') {
    return null;
  }
  return { requestId: value.requestId, code: value.code, message: value.message };
}

function readAccessList<T>(value: unknown, readItem: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = readItem(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

function readAccessUser(value: unknown): AccessUser | null {
  if (!isRecord(value)) return null;
  if (!isNonEmpty(value.id) || !isNonEmpty(value.login) || !isNonEmpty(value.displayName)) return null;
  if (value.role !== 'editor' && value.role !== 'admin') return null;
  if (!isNonEmpty(value.createdAt)) return null;
  if (value.revokedAt !== null && typeof value.revokedAt !== 'string') return null;
  return {
    id: value.id,
    login: value.login,
    displayName: value.displayName,
    role: value.role,
    createdAt: value.createdAt,
    revokedAt: value.revokedAt,
  };
}

function readAccessInvitation(value: unknown): AccessInvitation | null {
  if (!isRecord(value)) return null;
  if (!isNonEmpty(value.id) || !isNonEmpty(value.login) || !isNonEmpty(value.createdAt)) return null;
  if (value.invitedBy !== null && typeof value.invitedBy !== 'string') return null;
  return {
    id: value.id,
    login: value.login,
    invitedBy: value.invitedBy,
    createdAt: value.createdAt,
  };
}

function readAccess(message: Record<string, unknown>): AccessDirectory | null {
  const users = readAccessList(message.users, readAccessUser);
  const invitations = readAccessList(message.invitations, readAccessInvitation);
  if (users === null || invitations === null) return null;
  return { users, invitations };
}

export class SyncClient {
  private readonly deps: SyncDeps;
  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly pending = new Map<string, (outcome: OpOutcome) => void>();
  private readonly reads = new Map<string, { resolve: (value: Me | Board | Settings | null) => void; timer: unknown }>();
  /** Separate from `reads` so a refusal cannot null an in-flight read or raise an op notice. */
  private readonly results = new Map<string, ResultWaiter>();
  private readonly baselines = new Map<string, Board>();
  private state: SyncState = {
    status: 'connecting',
    boards: null,
    subscribedBoardId: null,
    board: null,
    ward: null,
    proposal: null,
    notice: null,
    me: null,
    settings: null,
    access: null,
  };
  private version: number | null = null;
  private socket: WebSocketLike | null = null;
  private generation = 0;
  private settledGeneration = -1;
  private openedGeneration = -1;
  private openedOnce = false;
  private running = false;
  private stopped = false;
  private forbidden = false;
  private resyncPending = false;
  private failures = 0;
  private reconnectTimer: unknown = null;
  private idleTimer: unknown = null;
  private replyTimer: unknown = null;

  constructor(deps: SyncDeps) {
    this.deps = deps;
  }

  start = (): void => {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.forbidden = false;
    this.patch({ status: 'connecting' });
    this.connect();
  };

  stop = (): void => {
    this.stopped = true;
    this.running = false;
    this.clearTimers();
    this.generation += 1;
    this.rejectPending();
    this.detachSocket();
    if (this.state.status !== 'forbidden' && this.state.status !== 'offline') {
      this.patch({ status: 'offline', access: null });
    } else if (this.state.access !== null) {
      this.patch({ access: null });
    }
  };

  getState = (): SyncState => this.state;

  subscribe = (listener: (state: SyncState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  open = (boardId: string): void => {
    if (this.state.subscribedBoardId !== boardId) {
      this.version = null;
      this.resyncPending = false;
      this.patch({
        subscribedBoardId: boardId,
        board: null,
        ward: null,
        proposal: null,
      });
    }
    if (this.state.status === 'live') this.sendJson({ type: 'subscribe', boardId });
  };

  send = (kind: OpKind, request: object): Promise<OpOutcome> => {
    if (
      this.state.status !== 'live' ||
      this.state.board === null ||
      this.version === null ||
      this.state.subscribedBoardId === null
    ) {
      return Promise.resolve(OFFLINE);
    }
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) return Promise.resolve(OFFLINE);
    const requestId = this.deps.requestIds();
    const boardId = this.state.subscribedBoardId;
    const baseVersion = this.version;
    socket.send(
      JSON.stringify({
        type: 'op',
        requestId,
        boardId,
        baseVersion,
        op: { kind, request },
      }),
    );
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
    });
  };

  dismissNotice = (): void => {
    if (this.state.notice === null) return;
    this.patch({ notice: null });
  };

  whoami = (): Promise<Me | null> => this.request<Me>((requestId) => ({ type: 'whoami', requestId }));

  fetchBoard = (boardId: string): Promise<Board | null> => {
    const cached = this.baselines.get(boardId);
    if (cached !== undefined) return Promise.resolve(cached);
    return this.request<Board>((requestId) => ({ type: 'getBoard', requestId, boardId }));
  };

  loadSettings = (): Promise<Settings | null> =>
    this.request<Settings>((requestId) => ({ type: 'getSettings', requestId }));

  createProposal = (input: {
    name: string;
    rationale: string | null;
    source: { kind: 'current' } | { kind: 'proposal'; proposalId: string };
  }): Promise<RequestResult<{ proposalId: string; boardId: string }>> =>
    this.requestResult<{ proposalId: string; boardId: string }>(
      (requestId) => ({
        type: 'createProposal',
        requestId,
        name: input.name,
        rationale: input.rationale,
        source: input.source,
      }),
      'proposalCreated',
    );

  updateMember = (memberId: string, patch: MemberPatch): Promise<RequestResult> =>
    this.requestResult(
      (requestId) => ({
        type: 'updateMember',
        requestId,
        memberId,
        patch,
      }),
      'memberUpdated',
    );

  setShowNeedsApproval = (value: boolean): Promise<RequestResult> =>
    this.requestResult(
      (requestId) => ({
        type: 'setShowNeedsApproval',
        requestId,
        value,
      }),
      'settings',
    );

  createTag = (name: string): Promise<RequestResult<{ tagId: string }>> =>
    this.requestResult<{ tagId: string }>((requestId) => ({ type: 'createTag', requestId, name }), 'tagCreated');

  renameTag = (tagId: string, name: string): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'renameTag', requestId, tagId, name }), 'memberUpdated');

  deleteTag = (tagId: string): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'deleteTag', requestId, tagId }), 'tagDeleted');

  getTagUsage = (tagId: string): Promise<RequestResult<TagUsage>> =>
    this.requestResult<TagUsage>((requestId) => ({ type: 'getTagUsage', requestId, tagId }), 'tagUsage');

  setNeedsApproval = (memberId: string, value: boolean): Promise<RequestResult> =>
    this.requestResult(
      (requestId) => ({ type: 'setNeedsApproval', requestId, memberId, value }),
      'memberUpdated',
    );

  setProposalStatus = (
    proposalId: string,
    status: 'draft' | 'accepted',
  ): Promise<RequestResult<{ status: 'draft' | 'accepted' }>> =>
    this.requestResult<{ status: 'draft' | 'accepted' }>(
      (requestId) => ({ type: 'setProposalStatus', requestId, proposalId, status }),
      'statusChanged',
    );

  getProposal = (proposalId: string): Promise<RequestResult<{ proposal: ProposalDetailView }>> =>
    this.requestResult<{ proposal: ProposalDetailView }>(
      (requestId) => ({ type: 'getProposal', requestId, proposalId }),
      'proposalDetail',
    );

  listAccess = (): Promise<RequestResult<{ users: AccessUser[]; invitations: AccessInvitation[] }>> =>
    this.requestResult<{ users: AccessUser[]; invitations: AccessInvitation[] }>(
      (requestId) => ({ type: 'listAccess', requestId }),
      'access',
    );

  invite = (login: string): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'invite', requestId, login }), 'accessUpdated');

  revokeInvitation = (invitationId: string): Promise<RequestResult> =>
    this.requestResult(
      (requestId) => ({ type: 'revokeInvitation', requestId, invitationId }),
      'accessUpdated',
    );

  revokeUser = (userId: string): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'revokeUser', requestId, userId }), 'accessUpdated');

  setRole = (userId: string, role: 'editor' | 'admin'): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'setRole', requestId, userId, role }), 'accessUpdated');

  transferAdmin = (toUserId: string): Promise<RequestResult> =>
    this.requestResult((requestId) => ({ type: 'transferAdmin', requestId, toUserId }), 'accessUpdated');

  private connect(): void {
    const generation = this.generation + 1;
    this.generation = generation;
    let socket: WebSocketLike;
    try {
      socket = this.deps.createSocket(this.deps.url);
    } catch {
      this.finish(generation, 1006);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.onOpen(generation);
    };
    socket.onmessage = (event) => {
      this.onMessage(generation, event.data);
    };
    socket.onclose = (event) => {
      const code = typeof event.code === 'number' ? event.code : 1006;
      this.finish(generation, code);
    };
    socket.onerror = () => {
      this.onError(generation, socket);
    };
    if (socket.readyState === 1) this.onOpen(generation);
  }

  private onOpen(generation: number): void {
    if (!this.alive(generation) || this.openedGeneration === generation) return;
    this.openedGeneration = generation;
    this.failures = 0;
    const reconnecting = this.openedOnce;
    this.openedOnce = true;
    if (reconnecting && this.state.subscribedBoardId !== null) this.resyncPending = true;
    this.patch({ status: 'live' });
    this.sendJson({ type: 'listBoards' });
    const boardId = this.state.subscribedBoardId;
    if (boardId !== null) this.sendJson({ type: 'subscribe', boardId });
    this.armIdle();
  }

  private onMessage(generation: number, data: unknown): void {
    if (!this.alive(generation)) return;
    this.noteReceived();
    const text = messageText(data);
    if (text === null) return;
    let parsed: unknown;
    try {
      parsed = parseJson(text);
    } catch {
      return;
    }
    if (!this.alive(generation) || !isRecord(parsed) || typeof parsed.type !== 'string') return;
    if (parsed.type === 'error' && parsed.code === 'forbidden') {
      this.enterForbidden(generation);
      return;
    }
    if (parsed.type === 'boards') this.applyBoards(parsed);
    else if (parsed.type === 'snapshot') {
      const message = readSnapshot(parsed);
      if (message !== null) this.applySnapshot(message);
    } else if (parsed.type === 'committed') {
      const message = readCommitted(parsed);
      if (message !== null) this.applyCommitted(message);
    } else if (parsed.type === 'ward') this.applyWard(parsed);
    else if (parsed.type === 'proposalChanged') this.applyProposalChanged(parsed);
    else if (parsed.type === 'settings') this.applySettings(parsed);
    else if (parsed.type === 'me') this.applyMe(parsed);
    else if (parsed.type === 'board') this.applyFetchedBoard(parsed);
    else if (parsed.type === 'proposalCreated') this.applyProposalCreated(parsed);
    else if (parsed.type === 'memberUpdated') this.applyMemberUpdated(parsed);
    else if (parsed.type === 'accessUpdated') this.applyAccessUpdated(parsed);
    else if (
      parsed.type === 'tagCreated' ||
      parsed.type === 'tagDeleted' ||
      parsed.type === 'tagUsage' ||
      parsed.type === 'statusChanged' ||
      parsed.type === 'proposalDetail'
    )
      this.applyTypedReply(parsed.type, parsed);
    else if (parsed.type === 'access') this.applyAccess(parsed);
    else if (parsed.type === 'rejected') {
      const message = readRejected(parsed);
      if (message === null) return;
      if (this.results.has(message.requestId)) {
        this.finishResult(message.requestId, {
          ok: false,
          code: message.code,
          message: message.message,
        });
        return;
      }
      if (this.reads.has(message.requestId)) this.finishRead(message.requestId, null);
      else this.applyRejected(message);
    }
  }

  private onError(generation: number, socket: WebSocketLike): void {
    if (!this.alive(generation)) return;
    if (socket.readyState === 2 || socket.readyState === 3) return;
    try {
      socket.close();
    } catch {
      this.finish(generation, 1006);
      return;
    }
    if (socket.readyState === 0 || socket.readyState === 1) this.finish(generation, 1006);
  }

  private applyBoards(message: Record<string, unknown>): void {
    const current = readCurrent(message.current);
    if (current === undefined || !Array.isArray(message.proposals)) return;
    const proposals: ProposalSummary[] = [];
    for (const item of message.proposals) {
      const summary = readProposalSummary(item);
      if (summary !== null) proposals.push(summary);
    }
    this.patch({ boards: { current, proposals } });
  }

  private applySnapshot(message: SnapshotMessage): void {
    if (message.boardId !== this.state.subscribedBoardId) return;
    this.version = message.version;
    const notice = this.resyncPending ? ({ kind: 'resynced' } as const) : this.state.notice;
    this.resyncPending = false;
    this.patch({
      board: message.board,
      ward: message.ward,
      proposal: message.proposal,
      notice,
    });
  }

  private applyCommitted(message: CommittedMessage): void {
    if (message.boardId !== this.state.subscribedBoardId) return;
    const local = this.version;
    if (local === null || message.version <= local) return;
    const resolve = this.pending.get(message.requestId);
    if (message.version === local + 1) {
      this.version = message.version;
      this.patch({ board: message.board });
      if (resolve !== undefined) {
        this.pending.delete(message.requestId);
        resolve({ ok: true, version: message.version });
      }
      return;
    }
    if (resolve !== undefined) {
      this.pending.delete(message.requestId);
      resolve({ ok: true, version: message.version });
    }
    this.resyncPending = true;
    this.sendJson({ type: 'subscribe', boardId: message.boardId });
  }

  private applyRejected(message: RejectedMessage): void {
    const resolve = this.pending.get(message.requestId);
    if (resolve === undefined) return;
    this.pending.delete(message.requestId);
    if (message.code === 'stale') {
      this.patch({ notice: { kind: 'stale', requestId: message.requestId } });
      const boardId = this.state.subscribedBoardId;
      if (boardId !== null) this.sendJson({ type: 'subscribe', boardId });
    } else {
      this.patch({
        notice: {
          kind: 'rejected',
          requestId: message.requestId,
          code: message.code,
          message: message.message,
        },
      });
    }
    resolve({ ok: false, code: message.code, message: message.message });
  }

  private finish(generation: number, code: number): void {
    if (!this.alive(generation)) return;
    this.settledGeneration = generation;
    this.clearWatchdog();
    this.socket = null;
    this.rejectPending();
    if (this.stopped) {
      if (this.state.status !== 'forbidden' && this.state.status !== 'offline') {
        this.patch({ status: 'offline', access: null });
      } else if (this.state.access !== null) {
        this.patch({ access: null });
      }
      return;
    }
    if (this.forbidden || code === FORBIDDEN_CLOSE) {
      this.forbidden = true;
      this.clearReconnect();
      this.patch({ status: 'forbidden', access: null });
      return;
    }
    this.patch({ status: 'offline', access: null });
    this.scheduleReconnect();
  }

  private enterForbidden(generation: number): void {
    if (!this.alive(generation)) return;
    this.forbidden = true;
    this.settledGeneration = generation;
    this.clearTimers();
    this.rejectPending();
    this.patch({ status: 'forbidden', access: null });
    this.detachSocket();
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const index = Math.min(this.failures, BACKOFF_MS.length - 1);
    const delay = BACKOFF_MS[index] ?? 30_000;
    this.failures += 1;
    this.reconnectTimer = this.deps.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || this.forbidden || !this.running) return;
      this.patch({ status: 'connecting' });
      this.connect();
    }, delay);
  }

  private noteReceived(): void {
    if (this.state.status !== 'live') return;
    this.armIdle();
  }

  private armIdle(): void {
    this.clearWatchdog();
    if (this.state.status !== 'live' || this.stopped) return;
    const generation = this.generation;
    this.idleTimer = this.deps.timers.setTimeout(() => {
      this.idleTimer = null;
      if (!this.alive(generation) || this.state.status !== 'live' || this.socket === null) return;
      this.sendJson({ type: 'listBoards' });
      this.replyTimer = this.deps.timers.setTimeout(() => {
        this.replyTimer = null;
        if (!this.alive(generation) || this.state.status !== 'live') return;
        const socket = this.socket;
        if (socket === null) return;
        try {
          socket.close();
        } catch {
          this.finish(generation, 1006);
          return;
        }
        if (socket.readyState === 0 || socket.readyState === 1) this.finish(generation, 1006);
      }, REPLY_MS);
    }, IDLE_MS);
  }

  private sendJson(message: { type: 'listBoards' } | { type: 'subscribe'; boardId: string }): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  }

  private request<T>(build: (requestId: string) => object): Promise<T | null> {
    if (this.state.status !== 'live') return Promise.resolve(null);
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) return Promise.resolve(null);
    const requestId = this.deps.requestIds();
    return new Promise((resolve) => {
      const timer = this.deps.timers.setTimeout(() => {
        this.finishRead(requestId, null);
      }, REPLY_MS);
      this.reads.set(requestId, {
        resolve: (value) => {
          resolve(value as T | null);
        },
        timer,
      });
      socket.send(JSON.stringify(build(requestId)));
    });
  }

  private requestResult<T = Record<string, never>>(
    build: (requestId: string) => object,
    reply: ResultReply,
  ): Promise<RequestResult<T>> {
    if (this.state.status !== 'live') return Promise.resolve(REQUEST_OFFLINE);
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) return Promise.resolve(REQUEST_OFFLINE);
    const requestId = this.deps.requestIds();
    return new Promise((resolve) => {
      const timer = this.deps.timers.setTimeout(() => {
        this.finishResult(requestId, REQUEST_OFFLINE);
      }, REPLY_MS);
      this.results.set(requestId, {
        resolve: (result) => {
          resolve(result);
        },
        timer,
        reply,
      });
      socket.send(JSON.stringify(build(requestId)));
    });
  }

  private finishResult(requestId: string, result: StoredResult): void {
    const waiter = this.results.get(requestId);
    if (waiter === undefined) return;
    this.results.delete(requestId);
    this.deps.timers.clearTimeout(waiter.timer);
    waiter.resolve(result);
  }

  private settleReply(reply: ResultReply, result: StoredResult): void {
    const requestIds: string[] = [];
    for (const [requestId, waiter] of this.results) {
      if (waiter.reply === reply) requestIds.push(requestId);
    }
    for (const requestId of requestIds) this.finishResult(requestId, result);
  }

  private finishRead(requestId: unknown, value: Me | Board | Settings | null): void {
    if (typeof requestId !== 'string') return;
    const waiter = this.reads.get(requestId);
    if (waiter === undefined) return;
    this.reads.delete(requestId);
    this.deps.timers.clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  private applyWard(message: Record<string, unknown>): void {
    if (!isRecord(message.ward)) return;
    this.patch({ ward: message.ward as unknown as Ward });
  }

  private applyProposalChanged(message: Record<string, unknown>): void {
    if (!isNonEmpty(message.boardId) || message.boardId !== this.state.subscribedBoardId) return;
    const current = this.state.proposal;
    if (current === null || !isRecord(message.proposal)) return;
    const { name, status, rationale } = message.proposal;
    if (typeof name !== 'string') return;
    if (status !== 'draft' && status !== 'accepted') return;
    if (!(typeof rationale === 'string' || rationale === null)) return;
    this.patch({ proposal: { ...current, name, status, rationale } });
  }

  private applySettings(message: Record<string, unknown>): void {
    if (typeof message.showNeedsApproval !== 'boolean') {
      this.finishRead(message.requestId, null);
      return;
    }
    const settings: Settings = { showNeedsApproval: message.showNeedsApproval };
    this.patch({ settings });
    this.finishRead(message.requestId, settings);
    // setShowNeedsApproval is answered by a broadcast whose requestId is empty.
    if (message.requestId === '') this.settleReply('settings', { ok: true });
  }

  private applyMe(message: Record<string, unknown>): void {
    const user = readMe(message.user);
    if (user === null || !this.reads.has(typeof message.requestId === 'string' ? message.requestId : '')) {
      this.finishRead(message.requestId, null);
      return;
    }
    this.patch({ me: user });
    this.finishRead(message.requestId, user);
  }

  private applyFetchedBoard(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    if (!this.reads.has(requestId)) return;
    if (!isRecord(message.board)) {
      this.finishRead(requestId, null);
      return;
    }
    const fetched = message.board as unknown as Board;
    if (fetched.kind === 'baseline' && isNonEmpty(fetched.id)) this.baselines.set(fetched.id, fetched);
    this.finishRead(requestId, fetched);
  }

  private applyProposalCreated(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const waiter = this.results.get(requestId);
    if (waiter === undefined || waiter.reply !== 'proposalCreated') return;
    if (!isNonEmpty(message.proposalId) || !isNonEmpty(message.boardId)) return;
    this.finishResult(requestId, {
      ok: true,
      proposalId: message.proposalId,
      boardId: message.boardId,
    });
  }

  private applyMemberUpdated(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const waiter = this.results.get(requestId);
    if (waiter === undefined || waiter.reply !== 'memberUpdated') return;
    this.finishResult(requestId, { ok: true });
  }

  private applyTypedReply(type: ResultReply, message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const waiter = this.results.get(requestId);
    if (waiter === undefined || waiter.reply !== type) return;
    if (type === 'tagCreated') {
      this.finishResult(
        requestId,
        isNonEmpty(message.tagId) ? { ok: true, tagId: message.tagId } : BAD_REPLY('tagCreated'),
      );
    } else if (type === 'tagDeleted') {
      this.finishResult(requestId, { ok: true });
    } else if (type === 'tagUsage') {
      const { members, callingPreferences, callingTags } = message;
      this.finishResult(
        requestId,
        isCount(members) && isCount(callingPreferences) && isCount(callingTags)
          ? { ok: true, members, callingPreferences, callingTags }
          : BAD_REPLY('tagUsage'),
      );
    } else if (type === 'statusChanged') {
      const { status } = message;
      this.finishResult(
        requestId,
        status === 'draft' || status === 'accepted' ? { ok: true, status } : BAD_REPLY('statusChanged'),
      );
    } else {
      const proposal = readProposalDetail(message.proposal);
      this.finishResult(requestId, proposal === null ? BAD_REPLY('proposalDetail') : { ok: true, proposal });
    }
  }

  private applyAccessUpdated(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const waiter = this.results.get(requestId);
    if (waiter === undefined || waiter.reply !== 'accessUpdated') return;
    this.finishResult(requestId, { ok: true });
  }

  private applyAccess(message: Record<string, unknown>): void {
    const access = readAccess(message);
    if (access === null) return;
    this.patch({ access });
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const waiter = this.results.get(requestId);
    if (waiter === undefined || waiter.reply !== 'access') return;
    this.finishResult(requestId, {
      ok: true,
      users: access.users,
      invitations: access.invitations,
    });
  }

  private rejectPending(): void {
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of waiters) resolve(OFFLINE);
    const reads = [...this.reads.entries()];
    this.reads.clear();
    for (const [, waiter] of reads) {
      this.deps.timers.clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    const results = [...this.results.values()];
    this.results.clear();
    for (const waiter of results) {
      this.deps.timers.clearTimeout(waiter.timer);
      waiter.resolve(REQUEST_OFFLINE);
    }
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      if (socket.readyState === 0 || socket.readyState === 1) socket.close();
    } catch {
      // The socket is already unusable.
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.deps.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearWatchdog(): void {
    if (this.idleTimer !== null) {
      this.deps.timers.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.replyTimer !== null) {
      this.deps.timers.clearTimeout(this.replyTimer);
      this.replyTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearReconnect();
    this.clearWatchdog();
  }

  private alive(generation: number): boolean {
    return generation === this.generation && this.settledGeneration !== generation;
  }

  private patch(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of [...this.listeners]) listener(this.state);
  }
}
