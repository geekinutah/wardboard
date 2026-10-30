import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  boardId,
  releaseCalling,
  sequentialIds,
  type Board,
  type CallingAssignment,
  type MemberId,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { extractPdf, importReports } from '@wardboard/importer';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/db/index.ts';
import { initializeCurrent } from '../../src/import/http.ts';
import { applyImport, emptyCurrentBoard, planImport, type ImportPlan, type ImportResolution } from '../../src/import/index.ts';
import { openStore, type Store } from '../../src/index.ts';
import { cleanupStores, openTempStore } from '../store/helpers.ts';
import { buildCurrent, bundle, importClock, row } from './helpers.ts';

/*
 * Fixture occupants from fixtures/lcr-reports/organizations-and-callings.pdf:
 * Bishopric / Bishopric: Bishop Stanley, Zed; Bishopric First Counselor Holwood, Wade;
 * Bishopric Second Counselor Marwell, Jonah.
 * Aaronic Priesthood Quorums / Priests Quorum Presidency: First Assistant Hartfield, Floyd;
 * Second Assistant Wrenford, Isaac Boyd; Secretary Rossdale, Howard.
 * The Aaronic bishop, counselors, and Priests Quorum President name the same three people.
 */

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/lcr-reports');
const organizationsPdf = readFileSync(path.join(fixturesDir, 'organizations-and-callings.pdf'));
const withoutPdf = readFileSync(path.join(fixturesDir, 'members-without-callings.pdf'));
const outPdf = readFileSync(path.join(fixturesDir, 'out-of-unit-callings.pdf'));
const memberListPdf = readFileSync(path.join(fixturesDir, 'member-list.pdf'));

const REFERENCE_TITLES = [
  'Bishop',
  'Bishopric First Counselor',
  'Bishopric Second Counselor',
  'Priests Quorum President',
] as const;

const databases: SqliteDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  cleanupStores();
});

async function openFirstStore(): Promise<Store> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-aaronic-links-'));
  directories.push(root);
  const db = openDatabase(path.join(root, 'aaronic-links.db'));
  databases.push(db);
  migrate(db);
  return openStore(db, importClock);
}

function fixtureBundle(): ReturnType<typeof importReports> {
  return importReports({
    organizations: extractPdf(new Uint8Array(organizationsPdf)),
    withoutCallings: extractPdf(new Uint8Array(withoutPdf)),
    outOfUnit: extractPdf(new Uint8Array(outPdf)),
    memberList: extractPdf(new Uint8Array(memberListPdf)),
  });
}

/** Plans and applies the fixture import against `current`, resolving every identity as a new adult where needed. */
function applyFixtureImport(store: Store, current: Board, expectedVersion: number): ReturnType<typeof applyImport> {
  const plan = planImport({ bundle: fixtureBundle(), ward: store.loadWard(), current });
  const resolutions: Record<string, ImportResolution> = {};
  for (const decision of plan.decisions) {
    if (decision.kind === 'ambiguous' || (decision.kind === 'new' && decision.category === null)) {
      resolutions[decision.key] = { action: 'new', category: 'adult' };
    }
  }
  return applyImport({ plan, resolutions, expectedVersion, ids: sequentialIds('link'), clock: importClock });
}

/** First import into a store with no Current; returns the stored Current board and ward. */
async function firstImport(): Promise<{ store: Store; board: Board; ward: Ward }> {
  const store = await openFirstStore();
  expect(store.loadCurrent()).toBeNull();
  const applied = applyFixtureImport(store, emptyCurrentBoard(boardId('board-aaronic-links')), 0);
  if (!applied.ok) throw new Error(`apply failed: ${applied.error}`);
  expect(initializeCurrent(store, applied).ok).toBe(true);
  const stored = store.loadCurrent();
  if (stored === null) throw new Error('first import did not create Current');
  return { store, board: stored.board, ward: store.loadWard() };
}

function rootBoardGroupName(board: Board, groupId: CallingAssignment['groupId']): string {
  let group = board.callingGroups[groupId];
  while (group !== undefined) {
    const parent = group.parent;
    if (parent.kind === 'boardGroup') {
      const root = board.boardGroups[parent.id];
      if (root === undefined) throw new Error(`board group ${parent.id} is missing`);
      return root.name;
    }
    group = board.callingGroups[parent.id];
  }
  throw new Error(`calling group ${groupId} is missing`);
}

function assignmentIn(board: Board, organization: string, groupName: string, title: string): CallingAssignment {
  const found = Object.values(board.assignments).filter((assignment) => {
    const group = board.callingGroups[assignment.groupId];
    return (
      group !== undefined &&
      group.name === groupName &&
      assignment.title === title &&
      rootBoardGroupName(board, assignment.groupId) === organization
    );
  });
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`expected one ${organization} / ${groupName} / ${title}, found ${String(found.length)}`);
  }
  return found[0];
}

function positionsOf(board: Board, assignment: CallingAssignment): PositionId[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignment.id)
    .sort((left, right) => left.order - right.order)
    .map((position) => position.id);
}

function occupied(
  board: Board,
  organization: string,
  groupName: string,
  title: string,
): { positionId: PositionId; memberId: MemberId }[] {
  return positionsOf(board, assignmentIn(board, organization, groupName, title)).flatMap((positionId) => {
    const memberId = board.placements[positionId];
    return memberId === undefined ? [] : [{ positionId, memberId }];
  });
}

function single(
  board: Board,
  organization: string,
  groupName: string,
  title: string,
): { positionId: PositionId; memberId: MemberId } {
  const seats = occupied(board, organization, groupName, title);
  if (seats.length !== 1 || seats[0] === undefined) throw new Error(`${title} is not a single occupied seat`);
  return seats[0];
}

function occupantName(board: Board, ward: Ward, organization: string, groupName: string, title: string): string {
  const seat = single(board, organization, groupName, title);
  const name = ward.members[seat.memberId]?.name;
  if (name === undefined) throw new Error(`missing member for ${title}`);
  return name;
}

function proposalFrom(store: Store): Board {
  const created = store.createProposal(
    { name: 'Aaronic links', rationale: null, source: { kind: 'current' } },
    sequentialIds('proposal'),
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value.board;
}

type Resolutions = Readonly<Record<string, ImportResolution>>;
type Bundle = ReturnType<typeof bundle>;

function prepare(input: Parameters<typeof buildCurrent>[0]): { db: DatabaseSync; store: Store } {
  const opened = openTempStore(importClock);
  const built = buildCurrent(input);
  const initialized = opened.store.initialize({
    ward: built.ward,
    current: built.current,
    importVersion: 'fixture',
  });
  if (!initialized.ok) {
    throw new Error(`${initialized.error.code}: ${initialized.error.message}`);
  }
  return opened;
}

function currentBoard(store: Store): Board {
  const current = store.loadCurrent();
  if (current === null) throw new Error('current board is missing');
  return current.board;
}

function planFor(store: Store, imported: Bundle): ImportPlan {
  return planImport({ bundle: imported, ward: store.loadWard(), current: currentBoard(store) });
}

function applyFor(
  store: Store,
  imported: Bundle,
  resolutions: Resolutions,
): { plan: ImportPlan; applied: ReturnType<typeof applyImport> } {
  const plan = planFor(store, imported);
  const applied = applyImport({
    plan,
    resolutions,
    expectedVersion: currentBoard(store).version,
    ids: sequentialIds('new'),
    clock: importClock,
  });
  return { plan, applied };
}

function snapshot(store: Store): {
  ward: Ward;
  current: NonNullable<ReturnType<Store['loadCurrent']>>;
  proposals: unknown[];
} {
  const current = store.loadCurrent();
  if (current === null) throw new Error('current board is missing');
  return {
    ward: store.loadWard(),
    current,
    proposals: store.listProposals().map((item) => store.loadProposal(item.id)),
  };
}

describe('aaronic bishopric links', () => {
  it('the import creates no Aaronic bishopric seats', async () => {
    const { board } = await firstImport();
    const outside = Object.values(board.assignments).filter((assignment) => {
      if (!REFERENCE_TITLES.some((title) => title === assignment.title)) return false;
      return rootBoardGroupName(board, assignment.groupId) !== 'Bishopric';
    });
    expect(outside.map((assignment) => `${rootBoardGroupName(board, assignment.groupId)} / ${assignment.title}`)).toEqual(
      [],
    );
    expect(Object.values(board.callingGroups).some((group) => group.name === 'Presidency of the Aaronic Priesthood')).toBe(
      false,
    );
  });

  it('the Bishopric keeps its seats and occupants', async () => {
    const { board, ward } = await firstImport();
    expect(occupantName(board, ward, 'Bishopric', 'Bishopric', 'Bishop')).toBe('Stanley, Zed');
    expect(occupantName(board, ward, 'Bishopric', 'Bishopric', 'Bishopric First Counselor')).toBe('Holwood, Wade');
    expect(occupantName(board, ward, 'Bishopric', 'Bishopric', 'Bishopric Second Counselor')).toBe('Marwell, Jonah');
  });

  it('the rest of the priests quorum imports', async () => {
    const { board, ward } = await firstImport();
    const organization = 'Aaronic Priesthood Quorums';
    const group = 'Priests Quorum Presidency';
    expect(occupantName(board, ward, organization, group, 'Priests Quorum First Assistant')).toBe('Hartfield, Floyd');
    expect(occupantName(board, ward, organization, group, 'Priests Quorum Second Assistant')).toBe('Wrenford, Isaac Boyd');
    expect(occupantName(board, ward, organization, group, 'Priests Quorum Secretary')).toBe('Rossdale, Howard');
  });

  it('a disagreeing reference blocks the import', () => {
    const { store } = prepare({ members: [], groups: [] });
    const differentBishop = bundle({
      organizations: [
        row('Bishopric', 'Bishopric', [
          { title: 'Bishop', occupant: 'Stanley, Zed' },
          { title: 'Bishopric First Counselor', occupant: 'Holwood, Wade' },
          { title: 'Bishopric Second Counselor', occupant: 'Marwell, Jonah' },
        ]),
        {
          name: 'Aaronic Priesthood Quorums',
          groups: [
            {
              name: 'Presidency of the Aaronic Priesthood',
              positions: [
                { title: 'Bishop', occupant: 'Other, Person' },
                { title: 'Bishopric First Counselor', occupant: 'Holwood, Wade' },
                { title: 'Bishopric Second Counselor', occupant: 'Marwell, Jonah' },
              ],
            },
            {
              name: 'Priests Quorum Presidency',
              positions: [{ title: 'Priests Quorum President', occupant: 'Stanley, Zed' }],
            },
          ],
        },
      ],
    });
    const before = snapshot(store);
    const disagreed = applyFor(store, differentBishop, {});
    expect(disagreed.plan.inconsistentReports).toBe(true);
    expect(disagreed.plan.decisions.some((decision) => decision.name === 'Other, Person')).toBe(true);
    expect(disagreed.applied).toEqual({ ok: false, error: 'inconsistent_reports' });
    expect(snapshot(store)).toEqual(before);

    const differentPresident = bundle({
      organizations: [
        row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Stanley, Zed' }]),
        row('Aaronic Priesthood Quorums', 'Priests Quorum Presidency', [
          { title: 'Priests Quorum President', occupant: 'Other, Person' },
        ]),
      ],
    });
    const president = applyFor(store, differentPresident, {});
    expect(president.plan.inconsistentReports).toBe(true);
    expect(president.applied).toEqual({ ok: false, error: 'inconsistent_reports' });
    expect(snapshot(store)).toEqual(before);

    const vacantBishopric = bundle({
      organizations: [
        row('Bishopric', 'Bishopric', [
          { title: 'Bishop', occupant: null },
          { title: 'Bishopric First Counselor', occupant: null },
          { title: 'Bishopric Second Counselor', occupant: null },
        ]),
        {
          name: 'Aaronic Priesthood Quorums',
          groups: [
            {
              name: 'Presidency of the Aaronic Priesthood',
              positions: [
                { title: 'Bishop', occupant: 'Stanley, Zed' },
                { title: 'Bishopric First Counselor', occupant: null },
                { title: 'Bishopric Second Counselor', occupant: null },
              ],
            },
            {
              name: 'Priests Quorum Presidency',
              positions: [{ title: 'Priests Quorum President', occupant: 'Stanley, Zed' }],
            },
          ],
        },
      ],
    });
    const namedWhileVacant = applyFor(store, vacantBishopric, {});
    expect(namedWhileVacant.plan.inconsistentReports).toBe(true);
    expect(namedWhileVacant.applied).toEqual({ ok: false, error: 'inconsistent_reports' });
    expect(snapshot(store)).toEqual(before);

    const folded = bundle({
      organizations: [
        row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Stanley, Zed' }]),
        row('Aaronic Priesthood Quorums', 'Priests Quorum Presidency', [
          { title: 'Priests Quorum President', occupant: '  stanley,   ZED ' },
        ]),
      ],
    });
    expect(planFor(store, folded).inconsistentReports).toBe(false);
    expect(snapshot(store)).toEqual(before);
  });

  it('vacant references agree with a vacant bishopric', () => {
    const { store } = prepare({ members: [], groups: [] });
    const imported = bundle({
      organizations: [
        row('Bishopric', 'Bishopric', [
          { title: 'Bishop', occupant: null },
          { title: 'Bishopric First Counselor', occupant: null },
          { title: 'Bishopric Second Counselor', occupant: null },
        ]),
        {
          name: 'Aaronic Priesthood Quorums',
          groups: [
            {
              name: 'Presidency of the Aaronic Priesthood',
              positions: [
                { title: 'Bishop', occupant: null },
                { title: 'Bishopric First Counselor', occupant: null },
                { title: 'Bishopric Second Counselor', occupant: null },
              ],
            },
            {
              name: 'Priests Quorum Presidency',
              positions: [
                { title: 'Priests Quorum President', occupant: null },
                { title: 'Priests Quorum Secretary', occupant: null },
              ],
            },
          ],
        },
      ],
    });
    const { plan, applied } = applyFor(store, imported, {});
    expect(plan.inconsistentReports).toBe(false);
    expect(applied.ok).toBe(true);
    expect(plan.rows.filter((item) => item.organization === 'Bishopric' && item.title === 'Bishop')).toHaveLength(1);
    expect(plan.rows.some((item) => item.group === 'Presidency of the Aaronic Priesthood')).toBe(false);
    expect(plan.rows.some((item) => item.title === 'Priests Quorum President')).toBe(false);
    expect(plan.rows.some((item) => item.title === 'Priests Quorum Secretary')).toBe(true);
    expect(
      plan.creations.some((creation) => creation.kind === 'callingGroup' && creation.name === 'Presidency of the Aaronic Priesthood'),
    ).toBe(false);
  });

  it('releasing the bishop in a proposal leaves no duplicate to release', async () => {
    const { store, ward } = await firstImport();
    const board = proposalFrom(store);
    const bishop = single(board, 'Bishopric', 'Bishopric', 'Bishop');
    const first = single(board, 'Bishopric', 'Bishopric', 'Bishopric First Counselor');
    const second = single(board, 'Bishopric', 'Bishopric', 'Bishopric Second Counselor');
    expect(ward.members[bishop.memberId]?.name).toBe('Stanley, Zed');
    expect(ward.members[first.memberId]?.name).toBe('Holwood, Wade');
    expect(ward.members[second.memberId]?.name).toBe('Marwell, Jonah');

    const people = new Set<MemberId>([bishop.memberId, first.memberId, second.memberId]);
    const held = Object.values(board.positions)
      .flatMap((position) => {
        const memberId = board.placements[position.id];
        if (memberId === undefined || !people.has(memberId)) return [];
        const assignment = board.assignments[position.assignmentId];
        if (assignment === undefined) return [];
        return [`${rootBoardGroupName(board, assignment.groupId)} / ${assignment.title}`];
      })
      .sort();
    expect(held).toEqual([
      'Bishopric / Bishop',
      'Bishopric / Bishopric First Counselor',
      'Bishopric / Bishopric Second Counselor',
    ]);

    const released = releaseCalling(board, { ward, ids: sequentialIds('release') }, bishop);
    if (!released.ok) throw new Error(released.error.message);
    const after = released.board.placements;
    expect(after[bishop.positionId]).toBeUndefined();
    expect(after[first.positionId]).toBeUndefined();
    expect(after[second.positionId]).toBeUndefined();
    const trio = new Set<PositionId>([bishop.positionId, first.positionId, second.positionId]);
    for (const position of Object.values(board.positions)) {
      if (trio.has(position.id)) continue;
      const memberId = board.placements[position.id];
      if (memberId === undefined || !people.has(memberId)) continue;
      expect(after[position.id]).toBe(memberId);
    }
  });
});
