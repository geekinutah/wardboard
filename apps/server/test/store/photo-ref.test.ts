import type { DatabaseSync } from 'node:sqlite';
import { memberId, type Member, type Ward } from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoreError, StoreResult } from '../../src/index.ts';
import { cleanupStores, openTempStore, take } from './helpers.ts';

afterEach(cleanupStores);

const REF = `${'cd'.repeat(32)}.png`;

function memberNamed(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((item) => item.name === name);
  if (member === undefined) throw new Error(`missing member ${name}`);
  return member;
}

function refusal(result: StoreResult<unknown>): StoreError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected refusal');
  return result.error;
}

function memberRow(db: DatabaseSync, id: string): { name: string; note: string | null; photo_ref: string | null; updated_at: string } {
  const row = db.prepare('SELECT name, note, photo_ref, updated_at FROM members WHERE id = ?').get(id);
  if (row === undefined) throw new Error(`missing row ${id}`);
  const name = row['name'];
  const note = row['note'];
  const photo = row['photo_ref'];
  const updated = row['updated_at'];
  if (typeof name !== 'string' || typeof updated !== 'string') throw new Error(`bad row ${id}`);
  if (note !== null && typeof note !== 'string') throw new Error(`bad note ${id}`);
  if (photo !== null && typeof photo !== 'string') throw new Error(`bad photo ${id}`);
  return { name, note, photo_ref: photo, updated_at: updated };
}

describe('photoRef store', () => {
  it('store persists photoRef and a later note leaves it', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'photos' }));
    const ada = memberNamed(ward, 'Ada Fictional');

    const updated = take(store.updateMemberProfile(ada.id, { photoRef: REF }));
    expect(updated.members[ada.id]).toEqual({ ...ward.members[ada.id], photoRef: REF });
    expect(store.loadWard().members[ada.id]).toEqual(updated.members[ada.id]);
    expect(memberRow(db, ada.id).photo_ref).toBe(REF);

    const noted = take(store.updateMemberProfile(ada.id, { note: 'Brings the rolls.' }));
    expect(noted.members[ada.id]).toEqual({
      ...ward.members[ada.id],
      photoRef: REF,
      note: 'Brings the rolls.',
    });
    expect(store.loadWard().members[ada.id]).toEqual(noted.members[ada.id]);
    expect(memberRow(db, ada.id).photo_ref).toBe(REF);

    const before = memberRow(db, ada.id);
    const missing = store.updateMemberProfile(memberId('missing-member'), { photoRef: REF });
    expect(refusal(missing).code).toBe('not_found');
    expect(memberRow(db, ada.id)).toEqual(before);
    expect(db.prepare('SELECT id FROM members WHERE id = ?').get('missing-member')).toBeUndefined();
  });
});
