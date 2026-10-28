import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { WebSocket, type RawData } from 'ws';
import {
  boardId as asBoardId,
  createProposal,
  proposalId,
  sequentialIds,
  userId,
  type Board,
  type CallingAssignment,
  type Member,
  type Position,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { expect } from 'vitest';
import { createAccess, type Access } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type IdentityProvider,
  type RunningServer,
  type StartServerOptions,
  type Store,
} from '../../src/index.ts';

export const FIXED_TIME = '2026-07-01T15:04:05.000Z';
export const BASE_URL = 'http://wardboard.example';
export const ADMIN: Identity = { login: 'admin@example.test', displayName: 'Admin Example' };
export const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Example' };
export const OVERSIZE_BYTES = 300 * 1024;

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const directories: string[] = [];

export function fixedClock(): Date {
  return new Date(FIXED_TIME);
}

export function countingIds(prefix: string): () => string {
  let next = 1;
  return () => {
    const id = `${prefix}-${String(next).padStart(4, '0')}`;
    next += 1;
    return id;
  };
}

export type Session = {
  server: RunningServer;
  dataDir: string;
  config: Config;
  options: StartServerOptions;
  db: DatabaseSync;
  store: Store;
  access: Access;
};

export async function startSession(options: {
  identity: Identity | null;
  initialAdminLogin?: string;
  seed?: (store: Store, db: DatabaseSync) => void;
}): Promise<Session> {
  const parent = await mkdtemp(path.join(tmpdir(), 'wardboard-t024-'));
  directories.push(parent);
  const dataDir = path.join(parent, 'data');
  if (options.seed !== undefined) {
    await mkdir(dataDir, { recursive: true });
    const seeding = openDatabase(databasePath(dataDir));
    try {
      migrate(seeding);
      options.seed(openStore(seeding, fixedClock), seeding);
    } finally {
      seeding.close();
    }
  }

  const config: Config = {
    dataDir,
    baseUrl: BASE_URL,
    port: 0,
    host: '127.0.0.1',
    ...(options.initialAdminLogin !== undefined ? { initialAdminLogin: options.initialAdminLogin } : {}),
  };
  const startOptions: StartServerOptions = {
    identityProvider: fixtureIdentityProvider(options.identity),
    clock: fixedClock,
    ids: countingIds('id'),
  };
  const server = await startServer(config, startOptions);
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  return {
    server,
    dataDir,
    config,
    options: startOptions,
    db,
    store: openStore(db, fixedClock),
    access: createAccess(db, fixedClock, countingIds('side')),
  };
}

export function startAdmin(seed?: (store: Store, db: DatabaseSync) => void): Promise<Session> {
  return startSession({
    identity: ADMIN,
    initialAdminLogin: ADMIN.login,
    ...(seed !== undefined ? { seed } : {}),
  });
}

const actorIdentities = new WeakMap<Session, Map<string, Identity>>();

/** Fixture identities are chosen per connection so an admin and an editor can share one channel. */
export async function startActorSession(): Promise<Session> {
  const identities = new Map<string, Identity>();
  const parent = await mkdtemp(path.join(tmpdir(), 'wardboard-t072-'));
  directories.push(parent);
  const dataDir = path.join(parent, 'data');
  const config: Config = {
    dataDir,
    baseUrl: BASE_URL,
    port: 0,
    host: '127.0.0.1',
    initialAdminLogin: ADMIN.login,
  };
  const identityProvider: IdentityProvider = {
    identify(req) {
      const token = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('actor');
      const found = token === null ? undefined : identities.get(token);
      const snapshot = found === undefined ? null : { login: found.login, displayName: found.displayName };
      return fixtureIdentityProvider(snapshot).identify(req);
    },
  };
  const options: StartServerOptions = {
    identityProvider,
    clock: fixedClock,
    ids: countingIds('id'),
  };
  const server = await startServer(config, options);
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  const session: Session = {
    server,
    dataDir,
    config,
    options,
    db,
    store: openStore(db, fixedClock),
    access: createAccess(db, fixedClock, countingIds('side')),
  };
  actorIdentities.set(session, identities);
  return session;
}

export function openActor(session: Session, identity: Identity): Promise<WebSocket> {
  const identities = actorIdentities.get(session);
  if (identities === undefined) {
    throw new Error('openActor requires startActorSession');
  }
  const token = `actor-${String(identities.size + 1)}`;
  identities.set(token, identity);
  return openSocket(session, new URL(BASE_URL).origin, `?actor=${token}`);
}

export async function restart(session: Session): Promise<void> {
  const dbIndex = databases.indexOf(session.db);
  if (dbIndex >= 0) databases.splice(dbIndex, 1);
  session.db.close();
  const serverIndex = servers.indexOf(session.server);
  if (serverIndex >= 0) servers.splice(serverIndex, 1);
  await session.server.close();
  const server = await startServer(session.config, session.options);
  servers.push(server);
  const db = openDatabase(databasePath(session.dataDir));
  databases.push(db);
  session.server = server;
  session.db = db;
  session.store = openStore(db, fixedClock);
  session.access = createAccess(db, fixedClock, countingIds('side'));
}

export async function cleanup(): Promise<void> {
  const running = servers.splice(0);
  for (const server of running) {
    await server.close();
  }
  for (const db of databases.splice(0)) {
    db.close();
  }
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export function seedDraftProposals(count: number): (store: Store, db: DatabaseSync) => void {
  return (store) => {
    const { ward, current } = buildFixtureWard();
    const initialized = store.initialize({ ward, current, importVersion: 'fixture' });
    if (!initialized.ok) {
      throw new Error(`${initialized.error.code}: ${initialized.error.message}`);
    }
    const ids = sequentialIds('proposal');
    for (let index = 0; index < count; index += 1) {
      const created = store.createProposal(
        {
          name: `Proposal ${String(index + 1)}`,
          rationale: index === 0 ? 'Because' : null,
          source: { kind: 'current' },
        },
        ids,
      );
      if (!created.ok) {
        throw new Error(`${created.error.code}: ${created.error.message}`);
      }
    }
  };
}

export function seedAcceptedProposal(store: Store, db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at)
     VALUES (?, ?, 'Approver', 'editor', ?)`,
  ).run('approver', 'approver@example.test', FIXED_TIME);
  const { ward, current } = buildFixtureWard();
  const initialized = store.initialize({ ward, current, importVersion: 'fixture' });
  if (!initialized.ok) {
    throw new Error(`${initialized.error.code}: ${initialized.error.message}`);
  }
  const draft = buildFixtureProposal(current, ward, {
    id: proposalId('pr-accepted'),
    name: 'Accepted plan',
  });
  const accepted = createProposal(
    {
      ...draft,
      status: 'accepted',
      accepted: { by: userId('approver'), at: FIXED_TIME, summary: 'Frozen summary.' },
    },
    ward,
  );
  if (!accepted.ok) {
    throw new Error(accepted.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
  }
  const inserted = store.insertProposal(accepted.value);
  if (!inserted.ok) {
    throw new Error(`${inserted.error.code}: ${inserted.error.message}`);
  }
}

export function socketUrl(session: Session, query = ''): string {
  return `ws://127.0.0.1:${String(session.server.port)}/api/ws${query}`;
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export class Inbox {
  private readonly queue: unknown[] = [];
  private readonly waiters: ((message: unknown) => void)[] = [];
  private closeCode: number | undefined;
  private readonly closeWaiters: ((code: number) => void)[] = [];

  constructor(ws: WebSocket) {
    ws.on('error', () => undefined);
    ws.on('message', (data) => {
      const message: unknown = JSON.parse(textOf(data));
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter(message);
      else this.queue.push(message);
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      const waiting = this.closeWaiters.splice(0);
      for (const waiter of waiting) waiter(code);
    });
  }

  next(): Promise<unknown> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => {
      this.closeWaiters.push(resolve);
    });
  }
}

export function openSocket(session: Session, origin: string | null = new URL(BASE_URL).origin, query = ''): Promise<WebSocket> {
  const ws = new WebSocket(socketUrl(session, query), origin === null ? undefined : { origin });
  return new Promise((resolve, reject) => {
    let settled = false;
    ws.once('open', () => {
      settled = true;
      ws.on('error', () => undefined);
      resolve(ws);
    });
    ws.once('unexpected-response', (_request, response) => {
      if (settled) return;
      settled = true;
      const status = response.statusCode ?? 0;
      response.resume();
      ws.terminate();
      reject(new Error(`unexpected ${String(status)}`));
    });
    ws.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function upgradeStatus(port: number, origin?: string): Promise<number> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${String(port)}/api/ws`,
    origin === undefined ? undefined : { origin },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve(status);
    };
    ws.once('open', () => {
      finish(101);
    });
    ws.once('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      finish(status);
    });
    ws.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected an object message, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

export async function subscribe(ws: WebSocket, inbox: Inbox, boardId: string): Promise<Record<string, unknown>> {
  const pending = inbox.next();
  ws.send(JSON.stringify({ type: 'subscribe', boardId }));
  const message = asRecord(await pending);
  expect(message.type).toBe('snapshot');
  return message;
}

export function opMessage(input: {
  requestId: string;
  boardId: string;
  baseVersion: number;
  kind: string;
  request: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'op',
    requestId: input.requestId,
    boardId: input.boardId,
    baseVersion: input.baseVersion,
    op: { kind: input.kind, request: input.request },
  });
}

export function memberNamed(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((item) => item.name === name);
  if (member === undefined) throw new Error(`missing member ${name}`);
  return member;
}

export function assignmentTitled(board: Board, title: string): CallingAssignment {
  const assignment = Object.values(board.assignments).find((item) => item.title === title);
  if (assignment === undefined) throw new Error(`missing assignment ${title}`);
  return assignment;
}

function positionsOf(board: Board, assignmentId: string): Position[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignmentId)
    .sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function vacantPosition(board: Board, title: string): Position {
  const assignment = assignmentTitled(board, title);
  const vacant = positionsOf(board, assignment.id).find((position) => !Object.hasOwn(board.placements, position.id));
  if (vacant === undefined) throw new Error(`no vacancy for ${title}`);
  return vacant;
}

export function occupiedPosition(board: Board, title: string): { positionId: string; memberId: string } {
  const assignment = assignmentTitled(board, title);
  const position = positionsOf(board, assignment.id).find((item) => Object.hasOwn(board.placements, item.id));
  if (position === undefined) throw new Error(`no occupant for ${title}`);
  const memberId = board.placements[position.id];
  if (memberId === undefined) throw new Error(`no occupant for ${title}`);
  return { positionId: position.id, memberId };
}

export function requireBoard(store: Store, id: string): Board {
  const board = store.loadBoard(asBoardId(id));
  if (board === null) throw new Error(`missing board ${id}`);
  return board;
}
