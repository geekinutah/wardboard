import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  assignmentId,
  boardId,
  callingGroupId,
  createBoard,
  positionId,
  releaseCalling,
  sequentialIds,
  wardOverview,
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
import { applyImport, emptyCurrentBoard, planImport, type ImportResolution } from '../../src/import/index.ts';
import { openStore, type Store } from '../../src/index.ts';
import { unwrap } from '../store/helpers.ts';
import { buildCurrent, importClock } from './helpers.ts';

/*
 * Titles and group names asserted below, as parsed from the fictional fixture
 * reports in fixtures/lcr-reports/organizations-and-callings.pdf:
 *
 * Organization "Bishopric", group "Bishopric":
 *   Bishop; Bishopric First Counselor; Bishopric Second Counselor;
 *   Ward Executive Secretary; Ward Assistant Executive Secretary (x2);
 *   Ward Clerk; Ward Assistant Clerk--Membership; Ward Assistant Clerk--Finance.
 * Organization "Elders Quorum", group "Elders Quorum Presidency":
 *   Elders Quorum President; Elders Quorum First Counselor;
 *   Elders Quorum Second Counselor; Elders Quorum Secretary.
 * Organization "Elders Quorum", group "Teachers": Elders Quorum Teacher (x5).
 * Groups ending in "Presidency": Elders Quorum Presidency, Relief Society Presidency,
 *   Priests Quorum Presidency, Teachers Quorum Presidency, Deacons Quorum Presidency,
 *   Young Women Presidency, Gatherers of Light Class Presidency, Messengers of Hope
 *   Class Presidency, Builders of Faith Class Presidency, Sunday School Presidency,
 *   Primary Presidency.
 */

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/lcr-reports');
const organizationsPdf = readFileSync(path.join(fixturesDir, 'organizations-and-callings.pdf'));
const withoutPdf = readFileSync(path.join(fixturesDir, 'members-without-callings.pdf'));
const outPdf = readFileSync(path.join(fixturesDir, 'out-of-unit-callings.pdf'));

const PRESIDENCY_GROUPS = [
  'Elders Quorum Presidency',
  'Relief Society Presidency',
  'Priests Quorum Presidency',
  'Teachers Quorum Presidency',
  'Deacons Quorum Presidency',
  'Young Women Presidency',
  'Gatherers of Light Class Presidency',
  'Messengers of Hope Class Presidency',
  'Builders of Faith Class Presidency',
  'Sunday School Presidency',
  'Primary Presidency',
] as const;

const databases: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function openTempStore(): Promise<Store> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-leadership-import-'));
  directories.push(root);
  const db = openDatabase(path.join(root, 'leadership.db'));
  databases.push(db);
  migrate(db);
  return openStore(db, importClock);
}

function fixtureBundle(): ReturnType<typeof importReports> {
  return importReports({
    organizations: extractPdf(new Uint8Array(organizationsPdf)),
    withoutCallings: extractPdf(new Uint8Array(withoutPdf)),
    outOfUnit: extractPdf(new Uint8Array(outPdf)),
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
  return applyImport({ plan, resolutions, expectedVersion, ids: sequentialIds('lead'), clock: importClock });
}

/** First import into a store with no Current; returns the stored Current board and ward. */
async function firstImport(): Promise<{ store: Store; board: Board; ward: Ward }> {
  const store = await openTempStore();
  expect(store.loadCurrent()).toBeNull();
  const applied = applyFixtureImport(store, emptyCurrentBoard(boardId('board-leadership')), 0);
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

/** The occupied positions of one calling, with their occupants. */
function occupied(board: Board, organization: string, groupName: string, title: string): { positionId: PositionId; memberId: MemberId }[] {
  return positionsOf(board, assignmentIn(board, organization, groupName, title)).flatMap((positionId) => {
    const memberId = board.placements[positionId];
    return memberId === undefined ? [] : [{ positionId, memberId }];
  });
}

function single(board: Board, organization: string, groupName: string, title: string): { positionId: PositionId; memberId: MemberId } {
  const seats = occupied(board, organization, groupName, title);
  if (seats.length !== 1 || seats[0] === undefined) throw new Error(`${title} is not a single occupied seat`);
  return seats[0];
}

function proposalFrom(store: Store): Board {
  const created = store.createProposal(
    { name: 'Leadership plan', rationale: null, source: { kind: 'current' } },
    sequentialIds('proposal'),
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value.board;
}

describe('imported leadership roles', () => {
  it('the imported bishopric shows the bishop and two counselors as leaders', async () => {
    const { board, ward } = await firstImport();
    const tile = wardOverview(board, null).find((candidate) => candidate.name === 'Bishopric');
    if (tile === undefined) throw new Error('no Bishopric tile');
    expect(tile.leaders.map((leader) => leader.title)).toEqual([
      'Bishop',
      'Bishopric First Counselor',
      'Bishopric Second Counselor',
    ]);
    for (const leader of tile.leaders) {
      expect(leader.memberId).not.toBeNull();
      expect(leader.proposed).toBe(false);
    }
    const names = tile.leaders.map((leader) => (leader.memberId === null ? null : ward.members[leader.memberId]?.name));
    expect(names).toEqual(['Stanley, Zed', 'Holwood, Wade', 'Marwell, Jonah']);
  });

  it('imported presidencies and the bishopric get their kinds', async () => {
    const { board } = await firstImport();
    const groups = Object.values(board.callingGroups);
    const bishopric = groups.filter((group) => group.name === 'Bishopric');
    expect(bishopric).toHaveLength(1);
    expect(bishopric[0]?.kind).toBe('bishopric');

    const presidencies = groups.filter((group) => group.name.endsWith(' Presidency'));
    expect(presidencies.map((group) => group.name).sort()).toEqual([...PRESIDENCY_GROUPS].sort());
    for (const group of presidencies) expect({ name: group.name, kind: group.kind }).toEqual({ name: group.name, kind: 'presidency' });

    const others = groups.filter((group) => group.name !== 'Bishopric' && !group.name.endsWith(' Presidency'));
    expect(others.length).toBeGreaterThan(0);
    for (const group of others) expect({ name: group.name, kind: group.kind }).toEqual({ name: group.name, kind: 'other' });
    expect(others.some((group) => group.name === 'Presidency of the Aaronic Priesthood')).toBe(true);
  });

  it('releasing an imported president releases the counselors and secretary', async () => {
    const { store, ward } = await firstImport();
    const board = proposalFrom(store);
    const org = 'Elders Quorum';
    const presidency = 'Elders Quorum Presidency';
    const president = single(board, org, presidency, 'Elders Quorum President');
    const first = single(board, org, presidency, 'Elders Quorum First Counselor');
    const second = single(board, org, presidency, 'Elders Quorum Second Counselor');
    const secretary = single(board, org, presidency, 'Elders Quorum Secretary');
    const teachers = occupied(board, org, 'Teachers', 'Elders Quorum Teacher');
    expect(teachers.length).toBeGreaterThan(0);

    const released = releaseCalling(board, { ward, ids: sequentialIds('release') }, president);
    if (!released.ok) throw new Error(released.error.message);
    const after = released.board.placements;
    expect(after[president.positionId]).toBeUndefined();
    expect(after[first.positionId]).toBeUndefined();
    expect(after[second.positionId]).toBeUndefined();
    expect(after[secretary.positionId]).toBeUndefined();
    for (const teacher of teachers) expect(after[teacher.positionId]).toBe(teacher.memberId);
  });

  it('releasing the imported bishop keeps the clerks and executive secretary', async () => {
    const { store, ward } = await firstImport();
    const board = proposalFrom(store);
    const org = 'Bishopric';
    const bishop = single(board, org, org, 'Bishop');
    const first = single(board, org, org, 'Bishopric First Counselor');
    const second = single(board, org, org, 'Bishopric Second Counselor');
    const support = [
      ...occupied(board, org, org, 'Ward Executive Secretary'),
      ...occupied(board, org, org, 'Ward Assistant Executive Secretary'),
      ...occupied(board, org, org, 'Ward Clerk'),
      ...occupied(board, org, org, 'Ward Assistant Clerk--Membership'),
      ...occupied(board, org, org, 'Ward Assistant Clerk--Finance'),
    ];
    expect(support).toHaveLength(5);

    const released = releaseCalling(board, { ward, ids: sequentialIds('release') }, bishop);
    if (!released.ok) throw new Error(released.error.message);
    const after = released.board.placements;
    expect(after[bishop.positionId]).toBeUndefined();
    // The release rule did fire for the bishopric (SPEC §5) ...
    expect(after[first.positionId]).toBeUndefined();
    expect(after[second.positionId]).toBeUndefined();
    // ... and left its support roles in place.
    for (const seat of support) expect(after[seat.positionId]).toBe(seat.memberId);
  });

  it('a re-import keeps existing slot configuration', async () => {
    const store = await openTempStore();
    const built = buildCurrent({
      version: 2,
      members: [],
      groups: [
        {
          id: 'bg-bishopric',
          name: 'Bishopric',
          key: 'bishopric',
          callingGroups: [
            {
              id: 'cg-bishopric',
              name: 'Bishopric',
              kind: 'other',
              assignments: [{ id: 'as-bishop', title: 'Bishop', positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop' }] }],
            },
          ],
        },
        {
          id: 'bg-eq',
          name: 'Elders Quorum',
          key: 'elders_quorum',
          callingGroups: [
            {
              id: 'cg-eq-presidency',
              name: 'Elders Quorum Presidency',
              kind: 'committee',
              assignments: [
                {
                  id: 'as-eq-secretary',
                  title: 'Elders Quorum Secretary',
                  leadershipRole: 'counselor',
                  positions: [{ id: 'pos-eq-secretary', lineageId: 'lin-eq-secretary' }],
                },
              ],
            },
          ],
        },
      ],
    });
    // Custom configuration a classifier would not produce: the secretary is a prominent counselor.
    const secretaryId = assignmentId('as-eq-secretary');
    const seededSecretary = built.current.assignments[secretaryId];
    if (seededSecretary === undefined) throw new Error('seed secretary missing');
    const seeded = unwrap(
      createBoard(
        { ...built.current, assignments: { ...built.current.assignments, [secretaryId]: { ...seededSecretary, prominent: true } } },
        built.ward,
      ),
    );
    const initialized = store.initialize({ ward: built.ward, current: seeded, importVersion: 'seed' });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const before = store.loadCurrent();
    if (before === null) throw new Error('seed missing');

    const applied = applyFixtureImport(store, before.board, before.board.version);
    if (!applied.ok) throw new Error(`apply failed: ${applied.error}`);
    const replaced = store.replaceCurrent({
      ward: applied.ward,
      current: applied.current,
      expectedVersion: before.board.version,
      importVersion: applied.importVersion,
      importedAt: applied.importedAt,
    });
    if (!replaced.ok) throw new Error(replaced.error.message);
    const after = store.loadCurrent();
    if (after === null) throw new Error('re-import lost Current');
    const board = after.board;

    // Matched slots keep their stored configuration.
    expect(board.assignments[assignmentId('as-bishop')]).toEqual(before.board.assignments[assignmentId('as-bishop')]);
    expect(board.assignments[assignmentId('as-bishop')]).toMatchObject({ prominent: false, leadershipRole: null });
    expect(board.assignments[secretaryId]).toEqual(before.board.assignments[secretaryId]);
    expect(board.assignments[secretaryId]).toMatchObject({ prominent: true, leadershipRole: 'counselor' });
    expect(board.callingGroups[callingGroupId('cg-bishopric')]?.kind).toBe('other');
    expect(board.callingGroups[callingGroupId('cg-eq-presidency')]?.kind).toBe('committee');
    // The import did place occupants into those matched slots.
    expect(board.placements[positionId('pos-bishop')]).toBeDefined();

    // Slots the import created are still classified.
    expect(assignmentIn(board, 'Bishopric', 'Bishopric', 'Bishopric First Counselor')).toMatchObject({
      prominent: true,
      leadershipRole: 'counselor',
    });
    expect(assignmentIn(board, 'Elders Quorum', 'Elders Quorum Presidency', 'Elders Quorum President')).toMatchObject({
      prominent: true,
      leadershipRole: 'president',
    });
    const reliefSociety = Object.values(board.callingGroups).find((group) => group.name === 'Relief Society Presidency');
    expect(reliefSociety?.kind).toBe('presidency');
  });
});
