import type { Board, Ward } from '@wardboard/core';
import type { OpKind, ProposalSummary } from '@wardboard/server';
import type { CurrentInfo, ProposalView } from './protocol.ts';

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
const REPLY_MS = 10_000;
const FORBIDDEN_CLOSE = 4403;
const OFFLINE: OpOutcome = { ok: false, code: 'offline', message: 'offline' };

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
  return value as ProposalSummary;
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

function readRejected(value: Record<string, unknown>): RejectedMessage | null {
  if (typeof value.requestId !== 'string' || typeof value.code !== 'string' || typeof value.message !== 'string') {
    return null;
  }
  return { requestId: value.requestId, code: value.code, message: value.message };
}

export class SyncClient {
  private readonly deps: SyncDeps;
  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly pending = new Map<string, (outcome: OpOutcome) => void>();
  private state: SyncState = {
    status: 'connecting',
    boards: null,
    subscribedBoardId: null,
    board: null,
    ward: null,
    proposal: null,
    notice: null,
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
      this.patch({ status: 'offline' });
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
    } else if (parsed.type === 'rejected') {
      const message = readRejected(parsed);
      if (message !== null) this.applyRejected(message);
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
        this.patch({ status: 'offline' });
      }
      return;
    }
    if (this.forbidden || code === FORBIDDEN_CLOSE) {
      this.forbidden = true;
      this.clearReconnect();
      this.patch({ status: 'forbidden' });
      return;
    }
    this.patch({ status: 'offline' });
    this.scheduleReconnect();
  }

  private enterForbidden(generation: number): void {
    if (!this.alive(generation)) return;
    this.forbidden = true;
    this.settledGeneration = generation;
    this.clearTimers();
    this.rejectPending();
    this.patch({ status: 'forbidden' });
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

  private rejectPending(): void {
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of waiters) resolve(OFFLINE);
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
