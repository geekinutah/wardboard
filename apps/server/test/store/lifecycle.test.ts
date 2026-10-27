import type { DatabaseSync } from 'node:sqlite';
import { proposalId, sequentialIds, userId } from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/index.ts';
import { openStore, type Store, type StoreClock } from '../../src/index.ts';
import { cleanupStores, fixedClock, insertUser, openTempStore, take } from './helpers.ts';

afterEach(cleanupStores);

function steppingClock(): StoreClock {
  let millis = Date.parse('2026-06-15T08:30:00.000Z');
  return () => {
    const value = new Date(millis);
    millis += 60_000;
    return value;
  };
}

function databaseFile(db: DatabaseSync): string {
  for (const row of db.prepare('PRAGMA database_list').all()) {
    if (row['name'] === 'main' && typeof row['file'] === 'string' && row['file'].length > 0) {
      return row['file'];
    }
  }
  throw new Error('database file is missing');
}

function acceptanceColumns(db: DatabaseSync, id: string): Record<string, unknown> {
  const row = db
    .prepare(
      `SELECT status, accepted_by, accepted_at, accepted_summary, version
       FROM boards WHERE proposal_id = ?`,
    )
    .get(id);
  if (row === undefined) throw new Error(`missing proposal row ${id}`);
  return row;
}

describe('proposal lifecycle store', () => {
  it('updateProposalMeta persists and leaves board version unchanged; Accepted → not_editable; unknown → not_found', () => {
    const clock = steppingClock();
    const { db, store } = openTempStore(clock);
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'lifecycle' }));
    const currentVersion = store.loadCurrent()?.board.version;
    const created = take(
      store.createProposal({ name: 'Alpha', rationale: 'first', source: { kind: 'current' } }, sequentialIds('life')),
    );
    expect(created.board.version).toBe(0);

    const renamed = take(
      store.updateProposalMeta(created.id, { name: 'Renamed plan', rationale: 'Because the ward grew' }),
    );
    expect(renamed.name).toBe('Renamed plan');
    expect(renamed.rationale).toBe('Because the ward grew');
    expect(renamed.createdAt).toBe(created.createdAt);
    expect(renamed.updatedAt).not.toBe(created.updatedAt);
    expect(renamed.board.version).toBe(0);
    expect(renamed.status).toBe('draft');
    expect(store.loadProposal(created.id)).toEqual(renamed);
    expect(store.listProposals().find((item) => item.id === created.id)?.version).toBe(0);
    expect(store.loadBoard(created.board.id)?.version).toBe(0);
    expect(store.loadCurrent()?.board.version).toBe(currentVersion);

    const cleared = take(store.updateProposalMeta(created.id, { name: 'Renamed plan', rationale: null }));
    expect(cleared.rationale).toBeNull();
    expect(cleared.board.version).toBe(0);
    expect(store.loadProposal(created.id)).toEqual(cleared);

    insertUser(db, 'user-ada');
    const accepted = take(
      store.setProposalAcceptance(created.id, {
        by: userId('user-ada'),
        at: '2026-06-15T12:00:00.000Z',
        summary: '[]',
      }),
    );
    expect(accepted.status).toBe('accepted');
    const refused = store.updateProposalMeta(created.id, { name: 'Nope', rationale: 'later' });
    expect(refused.ok).toBe(false);
    if (refused.ok) expect.fail('expected not_editable');
    expect(refused.error.code).toBe('not_editable');
    expect(store.loadProposal(created.id)).toEqual(accepted);
    expect(store.loadBoard(created.board.id)?.version).toBe(0);

    const missing = store.updateProposalMeta(proposalId('missing'), { name: 'Nope', rationale: null });
    expect(missing.ok).toBe(false);
    if (missing.ok) expect.fail('expected not_found');
    expect(missing.error.code).toBe('not_found');
    expect(store.listProposals()).toHaveLength(1);
  });

  it('setProposalAcceptance accept then reopen round-trips through reload; reopen clears all three columns', () => {
    const { db, store } = openTempStore(steppingClock());
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'lifecycle' }));
    const created = take(
      store.createProposal({ name: 'Alpha', rationale: null, source: { kind: 'current' } }, sequentialIds('acc')),
    );
    insertUser(db, 'user-ada');
    const acceptance = {
      by: userId('user-ada'),
      at: '2026-07-04T16:05:06.000Z',
      summary: '[{"key":"bishop","heading":"Bishop","callings":[],"releases":[]}]',
    };

    const accepted = take(store.setProposalAcceptance(created.id, acceptance));
    expect(accepted.status).toBe('accepted');
    expect(accepted.accepted).toEqual(acceptance);
    expect(accepted.board.version).toBe(created.board.version);
    expect(accepted.updatedAt).not.toBe(created.updatedAt);
    expect(acceptanceColumns(db, created.id)).toMatchObject({
      status: 'accepted',
      accepted_by: 'user-ada',
      accepted_at: acceptance.at,
      accepted_summary: acceptance.summary,
      version: created.board.version,
    });

    const file = databaseFile(db);
    const reloaded = openLoaded(file);
    try {
      expect(reloaded.store.loadProposal(created.id)).toEqual(accepted);
      expect(acceptanceColumns(reloaded.db, created.id)).toMatchObject({
        status: 'accepted',
        accepted_by: 'user-ada',
        accepted_at: acceptance.at,
        accepted_summary: acceptance.summary,
      });
    } finally {
      reloaded.db.close();
    }

    const reopened = take(store.setProposalAcceptance(created.id, null));
    expect(reopened.status).toBe('draft');
    expect(reopened.accepted).toBeNull();
    expect(reopened.board.version).toBe(created.board.version);
    expect(reopened.name).toBe(created.name);
    expect(acceptanceColumns(db, created.id)).toEqual({
      status: 'draft',
      accepted_by: null,
      accepted_at: null,
      accepted_summary: null,
      version: created.board.version,
    });

    const again = openLoaded(file);
    try {
      expect(again.store.loadProposal(created.id)).toEqual(reopened);
      expect(acceptanceColumns(again.db, created.id)).toEqual({
        status: 'draft',
        accepted_by: null,
        accepted_at: null,
        accepted_summary: null,
        version: created.board.version,
      });
    } finally {
      again.db.close();
    }

    const missing = store.setProposalAcceptance(proposalId('missing'), null);
    expect(missing.ok).toBe(false);
    if (missing.ok) expect.fail('expected not_found');
    expect(missing.error.code).toBe('not_found');
  });
});

function openLoaded(file: string): { db: DatabaseSync; store: Store } {
  const db = openDatabase(file);
  return { db, store: openStore(db, fixedClock) };
}
