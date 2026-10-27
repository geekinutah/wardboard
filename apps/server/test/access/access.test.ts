import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccess,
  type Access,
  type AccessResult,
  type User,
} from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import type { Identity } from '../../src/identity/index.ts';

const TIMESTAMP = '2026-01-02T03:04:05.000Z';
const OLD_CREATED_AT = '2020-01-01T00:00:00.000Z';
const OLD_REVOKED_AT = '2020-06-01T00:00:00.000Z';

const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = {
  access: Access;
  db: DatabaseSync;
};

async function harness(): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-access-'));
  tempDirs.push(dir);
  const db = openDatabase(databasePath(dir));
  databases.push(db);
  migrate(db);
  let nextId = 0;
  const access = createAccess(
    db,
    () => new Date(TIMESTAMP),
    () => {
      nextId += 1;
      return `id-${String(nextId)}`;
    },
  );
  return { access, db };
}

function identity(login: string, displayName: string): Identity {
  return { login, displayName };
}

function expectUser(result: { ok: true; user: User } | { ok: false }): User {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected resolve to allow access');
  }
  return result.user;
}

function expectValue<T>(result: AccessResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.code}`);
  }
  return result.value;
}

function userByLogin(access: Access, login: string): User {
  const user = access.listUsers().find((candidate) => candidate.login === login);
  expect(user, login).toBeDefined();
  if (user === undefined) {
    throw new Error(`missing user ${login}`);
  }
  return user;
}

function insertUser(
  db: DatabaseSync,
  fields: {
    id: string;
    login: string;
    displayName: string;
    role: 'editor' | 'admin';
    revokedAt: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.id,
    fields.login,
    fields.displayName,
    fields.role,
    OLD_CREATED_AT,
    fields.revokedAt,
  );
}

function tableRows(db: DatabaseSync, table: 'users' | 'invitations'): unknown[] {
  if (table === 'users') {
    return db
      .prepare(
        `SELECT id, login, display_name, role, created_at, revoked_at
         FROM users ORDER BY login, id`,
      )
      .all();
  }
  return db
    .prepare(
      `SELECT id, login, invited_by, created_at, revoked_at
       FROM invitations ORDER BY login, id`,
    )
    .all();
}

describe('access service', () => {
  it('unknown login has no access', async () => {
    const { access } = await harness();

    expect(access.listUsers()).toEqual([]);
    expect(access.listInvitations()).toEqual([]);
    expect(access.resolve(identity('nobody@example.test', 'Nobody'))).toEqual({ ok: false });
    expect(access.listUsers()).toEqual([]);
  });

  it('bootstrap creates the first admin once', async () => {
    const { access } = await harness();

    expect(access.bootstrapAdmin('mike@example.test')).toBe('created');
    expect(access.listUsers()).toEqual([
      {
        id: 'id-1',
        login: 'mike@example.test',
        displayName: 'mike@example.test',
        role: 'admin',
        createdAt: TIMESTAMP,
        revokedAt: null,
      },
    ]);

    expect(access.bootstrapAdmin('other@example.test')).toBe('exists');
    expect(access.listUsers()).toEqual([
      {
        id: 'id-1',
        login: 'mike@example.test',
        displayName: 'mike@example.test',
        role: 'admin',
        createdAt: TIMESTAMP,
        revokedAt: null,
      },
    ]);
  });

  it('bootstrap reactivates and promotes an existing revoked user when no admin exists', async () => {
    const { access, db } = await harness();
    insertUser(db, {
      id: 'preexisting',
      login: 'former@example.test',
      displayName: 'Former Name',
      role: 'editor',
      revokedAt: OLD_REVOKED_AT,
    });

    expect(access.bootstrapAdmin('former@example.test')).toBe('created');

    expect(access.listUsers()).toEqual([
      {
        id: 'preexisting',
        login: 'former@example.test',
        displayName: 'Former Name',
        role: 'admin',
        createdAt: OLD_CREATED_AT,
        revokedAt: null,
      },
    ]);
  });

  it('bootstrap promotes an existing active editor when no admin exists', async () => {
    const { access, db } = await harness();
    insertUser(db, {
      id: 'editor-row',
      login: 'editor@example.test',
      displayName: 'Existing Editor',
      role: 'editor',
      revokedAt: null,
    });

    expect(access.bootstrapAdmin('editor@example.test')).toBe('created');
    expect(access.listUsers()).toEqual([
      {
        id: 'editor-row',
        login: 'editor@example.test',
        displayName: 'Existing Editor',
        role: 'admin',
        createdAt: OLD_CREATED_AT,
        revokedAt: null,
      },
    ]);
  });

  it('bootstrap leaves an unrelated revoked user revoked', async () => {
    const { access, db } = await harness();
    insertUser(db, {
      id: 'revoked-other',
      login: 'other@example.test',
      displayName: 'Other',
      role: 'admin',
      revokedAt: OLD_REVOKED_AT,
    });

    expect(access.bootstrapAdmin('mike@example.test')).toBe('created');
    const users = access.listUsers();
    expect(users.map((user) => user.login)).toEqual(['mike@example.test', 'other@example.test']);
    expect(userByLogin(access, 'other@example.test')).toMatchObject({
      id: 'revoked-other',
      role: 'admin',
      revokedAt: OLD_REVOKED_AT,
    });
    expect(userByLogin(access, 'mike@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: null,
    });
  });

  it('invitation is accepted on first resolve', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    const invited = expectValue(access.invite(admin.id, 'new@example.test'));

    expect(invited).toMatchObject({
      login: 'new@example.test',
      invitedBy: admin.id,
      createdAt: TIMESTAMP,
    });
    expect(access.listInvitations()).toEqual([invited]);

    const user = expectUser(access.resolve(identity('new@example.test', 'New Person')));
    expect(user).toMatchObject({
      login: 'new@example.test',
      displayName: 'New Person',
      role: 'editor',
      createdAt: TIMESTAMP,
      revokedAt: null,
    });
    expect(user.role).not.toBe('admin');
    expect(access.listInvitations()).toEqual([]);
    expect(userByLogin(access, 'new@example.test')).toEqual(user);
  });

  it('revoked user is refused until re-invited', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'member@example.test'));
    const created = expectUser(access.resolve(identity('member@example.test', 'First Name')));
    const promoted = expectValue(access.setRole(admin.id, created.id, 'admin'));
    expect(promoted.role).toBe('admin');

    expect(access.revokeUser(admin.id, created.id)).toEqual({ ok: true, value: undefined });
    expect(access.resolve(identity('member@example.test', 'First Name'))).toEqual({ ok: false });
    expect(userByLogin(access, 'member@example.test').revokedAt).toBe(TIMESTAMP);

    expectValue(access.invite(admin.id, 'member@example.test'));
    const returned = expectUser(access.resolve(identity('member@example.test', 'Second Name')));
    expect(returned).toMatchObject({
      id: created.id,
      login: 'member@example.test',
      displayName: 'Second Name',
      role: 'editor',
      revokedAt: null,
    });
    expect(access.listInvitations()).toEqual([]);
  });

  it('display name follows identity', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('mike@example.test');

    const first = expectUser(access.resolve(identity('mike@example.test', 'Mike')));
    expect(first.displayName).toBe('Mike');
    expect(first.role).toBe('admin');

    const second = expectUser(access.resolve(identity('mike@example.test', 'Michael Wilson')));
    expect(second).toMatchObject({
      id: first.id,
      login: 'mike@example.test',
      displayName: 'Michael Wilson',
      role: 'admin',
      revokedAt: null,
    });
    expect(userByLogin(access, 'mike@example.test').displayName).toBe('Michael Wilson');

    const same = expectUser(access.resolve(identity('mike@example.test', 'Michael Wilson')));
    expect(same).toEqual(second);
  });

  it('editor cannot perform any admin mutation', async () => {
    const { access, db } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'editor@example.test'));
    const editor = expectUser(access.resolve(identity('editor@example.test', 'Editor')));
    expectValue(access.invite(admin.id, 'other@example.test'));
    const other = expectUser(access.resolve(identity('other@example.test', 'Other')));
    const pending = expectValue(access.invite(admin.id, 'pending@example.test'));

    const usersBefore = tableRows(db, 'users');
    const invitationsBefore = tableRows(db, 'invitations');

    expect(access.invite(editor.id, 'not a login')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.invite(editor.id, 'fresh@example.test')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.revokeInvitation(editor.id, pending.id)).toEqual({ ok: false, code: 'forbidden' });
    expect(access.revokeUser(editor.id, admin.id)).toEqual({ ok: false, code: 'forbidden' });
    expect(access.setRole(editor.id, editor.id, 'admin')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.transferAdmin(editor.id, other.id)).toEqual({ ok: false, code: 'forbidden' });
    expect(access.invite('missing-actor', 'fresh@example.test')).toEqual({
      ok: false,
      code: 'forbidden',
    });

    expect(tableRows(db, 'users')).toEqual(usersBefore);
    expect(tableRows(db, 'invitations')).toEqual(invitationsBefore);
    expect(access.listInvitations().map((invitation) => invitation.login)).toEqual([
      'pending@example.test',
    ]);
  });

  it('revoked admin cannot act', async () => {
    const { access, db } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'second@example.test'));
    const second = expectUser(access.resolve(identity('second@example.test', 'Second')));
    expectValue(access.setRole(admin.id, second.id, 'admin'));
    expect(access.revokeUser(admin.id, second.id)).toEqual({ ok: true, value: undefined });

    const pending = expectValue(access.invite(admin.id, 'pending@example.test'));
    const usersBefore = tableRows(db, 'users');
    const invitationsBefore = tableRows(db, 'invitations');

    expect(access.invite(second.id, 'fresh@example.test')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.revokeInvitation(second.id, pending.id)).toEqual({ ok: false, code: 'forbidden' });
    expect(access.revokeUser(second.id, admin.id)).toEqual({ ok: false, code: 'forbidden' });
    expect(access.setRole(second.id, admin.id, 'editor')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.transferAdmin(second.id, admin.id)).toEqual({ ok: false, code: 'forbidden' });

    expect(tableRows(db, 'users')).toEqual(usersBefore);
    expect(tableRows(db, 'invitations')).toEqual(invitationsBefore);
  });

  it('invite validates and deduplicates', async () => {
    const { access, db } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');

    const invited = expectValue(access.invite(admin.id, ' Bob@X.test '));
    expect(invited.login).toBe('bob@x.test');
    expect(invited.invitedBy).toBe(admin.id);
    expect(invited.createdAt).toBe(TIMESTAMP);
    expect(access.listInvitations()).toEqual([invited]);

    expect(access.invite(admin.id, 'bob@x.test')).toEqual({ ok: false, code: 'already_invited' });
    expect(access.invite(admin.id, 'BOB@x.test')).toEqual({ ok: false, code: 'already_invited' });
    expect(access.invite(admin.id, ' Admin@Example.test ')).toEqual({
      ok: false,
      code: 'already_user',
    });

    for (const login of [
      'a b@x',
      'a,b@x.test',
      '',
      '   ',
      'a<b@x.test',
      'a>b@x.test',
      'a\u0007@x.test',
      'a\u007f@x.test',
      `${'a'.repeat(242)}@example.test`,
    ]) {
      expect(access.invite(admin.id, login), JSON.stringify(login)).toEqual({
        ok: false,
        code: 'invalid_login',
      });
    }

    const maxLogin = `${'a'.repeat(241)}@example.test`;
    expect(maxLogin.length).toBe(254);
    expect(expectValue(access.invite(admin.id, maxLogin)).login).toBe(maxLogin);
    expect(access.listInvitations().map((invitation) => invitation.login)).toEqual([
      maxLogin,
      'bob@x.test',
    ]);

    expect(access.revokeInvitation(admin.id, 'missing-invitation')).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(access.revokeInvitation(admin.id, invited.id)).toEqual({ ok: true, value: undefined });
    expect(access.listInvitations().map((invitation) => invitation.login)).toEqual([maxLogin]);
    const revokedRow = db.prepare('SELECT revoked_at FROM invitations WHERE id = ?').get(invited.id);
    expect(revokedRow?.['revoked_at']).toBe(TIMESTAMP);
    expect(access.revokeInvitation(admin.id, invited.id)).toEqual({ ok: false, code: 'revoked' });

    const again = expectValue(access.invite(admin.id, 'bob@x.test'));
    expect(again.id).not.toBe(invited.id);
    expect(access.listInvitations().map((invitation) => invitation.login)).toEqual([
      maxLogin,
      'bob@x.test',
    ]);
    const bobRows = db
      .prepare('SELECT revoked_at FROM invitations WHERE login = ? ORDER BY id')
      .all('bob@x.test');
    expect(bobRows).toHaveLength(2);
    expect(bobRows.filter((row) => row['revoked_at'] === null)).toHaveLength(1);
  });

  it('last admin cannot be revoked or demoted', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');

    expect(access.revokeUser(admin.id, 'missing-user')).toEqual({ ok: false, code: 'not_found' });
    expect(access.setRole(admin.id, 'missing-user', 'editor')).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(access.revokeUser(admin.id, admin.id)).toEqual({ ok: false, code: 'last_admin' });
    expect(access.setRole(admin.id, admin.id, 'editor')).toEqual({ ok: false, code: 'last_admin' });
    expect(userByLogin(access, 'admin@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: null,
    });

    expectValue(access.invite(admin.id, 'second@example.test'));
    const second = expectUser(access.resolve(identity('second@example.test', 'Second')));
    expectValue(access.setRole(admin.id, second.id, 'admin'));

    expect(access.revokeUser(admin.id, second.id)).toEqual({ ok: true, value: undefined });
    expect(userByLogin(access, 'second@example.test').revokedAt).toBe(TIMESTAMP);
    expect(access.revokeUser(admin.id, second.id)).toEqual({ ok: false, code: 'revoked' });
    expect(access.setRole(admin.id, second.id, 'editor')).toEqual({ ok: false, code: 'revoked' });

    expect(access.revokeUser(admin.id, admin.id)).toEqual({ ok: false, code: 'last_admin' });
    expect(access.setRole(admin.id, admin.id, 'editor')).toEqual({ ok: false, code: 'last_admin' });

    expectValue(access.invite(admin.id, 'third@example.test'));
    const third = expectUser(access.resolve(identity('third@example.test', 'Third')));
    expectValue(access.setRole(admin.id, third.id, 'admin'));
    const demoted = expectValue(access.setRole(admin.id, third.id, 'editor'));
    expect(demoted).toMatchObject({ id: third.id, role: 'editor', revokedAt: null });
    expect(userByLogin(access, 'admin@example.test').role).toBe('admin');
  });

  it('non-last admin can revoke themselves', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'second@example.test'));
    const second = expectUser(access.resolve(identity('second@example.test', 'Second')));
    expectValue(access.setRole(admin.id, second.id, 'admin'));

    expect(access.revokeUser(second.id, second.id)).toEqual({ ok: true, value: undefined });
    expect(userByLogin(access, 'second@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: TIMESTAMP,
    });
    expect(userByLogin(access, 'admin@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: null,
    });
    expect(access.invite(second.id, 'fresh@example.test')).toEqual({ ok: false, code: 'forbidden' });
    expect(access.revokeUser(admin.id, admin.id)).toEqual({ ok: false, code: 'last_admin' });
  });

  it('transfer admin swaps roles atomically', async () => {
    const { access } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'editor@example.test'));
    const editor = expectUser(access.resolve(identity('editor@example.test', 'Editor')));

    expect(access.transferAdmin(admin.id, admin.id)).toEqual({ ok: false, code: 'invalid_login' });
    expect(userByLogin(access, 'admin@example.test').role).toBe('admin');
    expect(userByLogin(access, 'editor@example.test').role).toBe('editor');

    expect(access.transferAdmin(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
    expect(userByLogin(access, 'admin@example.test')).toMatchObject({
      role: 'editor',
      revokedAt: null,
    });
    expect(userByLogin(access, 'editor@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: null,
    });
  });

  it('transfer to a revoked or unknown user is refused and nothing changes', async () => {
    const { access, db } = await harness();
    access.bootstrapAdmin('admin@example.test');
    const admin = userByLogin(access, 'admin@example.test');
    expectValue(access.invite(admin.id, 'member@example.test'));
    const member = expectUser(access.resolve(identity('member@example.test', 'Member')));
    expectValue(access.setRole(admin.id, member.id, 'admin'));
    expect(access.revokeUser(admin.id, member.id)).toEqual({ ok: true, value: undefined });

    const usersBefore = tableRows(db, 'users');
    const invitationsBefore = tableRows(db, 'invitations');

    expect(access.transferAdmin(admin.id, 'missing-user')).toEqual({ ok: false, code: 'not_found' });
    expect(access.transferAdmin(admin.id, member.id)).toEqual({ ok: false, code: 'revoked' });

    expect(tableRows(db, 'users')).toEqual(usersBefore);
    expect(tableRows(db, 'invitations')).toEqual(invitationsBefore);
    expect(userByLogin(access, 'admin@example.test').role).toBe('admin');
    expect(userByLogin(access, 'member@example.test')).toMatchObject({
      role: 'admin',
      revokedAt: TIMESTAMP,
    });
  });
});
