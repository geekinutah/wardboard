import type { IncomingMessage } from 'node:http';
import { type DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { Identity } from '../identity/index.ts';
import { normalizeLogin } from './login.ts';

export type Role = 'editor' | 'admin';

export type User = {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  createdAt: string;
  revokedAt: string | null;
};

export type Invitation = {
  id: string;
  login: string;
  invitedBy: string | null;
  createdAt: string;
};

export type AccessErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_login'
  | 'already_user'
  | 'already_invited'
  | 'last_admin'
  | 'revoked';

export type AccessResult<T> = { ok: true; value: T } | { ok: false; code: AccessErrorCode };

export interface Access {
  resolve(identity: Identity): { ok: true; user: User } | { ok: false };
  bootstrapAdmin(login: string): 'created' | 'exists';
  listUsers(): readonly User[];
  listInvitations(): readonly Invitation[];
  invite(actorId: string, login: string): AccessResult<Invitation>;
  revokeInvitation(actorId: string, invitationId: string): AccessResult<void>;
  revokeUser(actorId: string, userId: string): AccessResult<void>;
  setRole(actorId: string, userId: string, role: Role): AccessResult<User>;
  transferAdmin(actorId: string, toUserId: string): AccessResult<void>;
}

type InvitationRow = Invitation & { revokedAt: string | null };

const USER_SQL = `SELECT id, login, display_name, role, created_at, revoked_at FROM users`;

const authenticatedUsers = new WeakMap<IncomingMessage, User>();

export function setAuthenticatedUser(req: IncomingMessage, user: User): void {
  authenticatedUsers.set(req, user);
}

export function getAuthenticatedUser(req: IncomingMessage): User | undefined {
  return authenticatedUsers.get(req);
}

function fail(code: AccessErrorCode): AccessResult<never> {
  return { ok: false, code };
}

function text(row: Record<string, SQLOutputValue>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} is not text`);
  }
  return value;
}

function optionalText(row: Record<string, SQLOutputValue>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${key} is not text`);
  }
  return value;
}

function roleOf(value: string): Role {
  if (value === 'editor' || value === 'admin') return value;
  throw new Error('users.role is invalid');
}

function mapUser(row: Record<string, SQLOutputValue>): User {
  return {
    id: text(row, 'id'),
    login: text(row, 'login'),
    displayName: text(row, 'display_name'),
    role: roleOf(text(row, 'role')),
    createdAt: text(row, 'created_at'),
    revokedAt: optionalText(row, 'revoked_at'),
  };
}

function mapInvitation(row: Record<string, SQLOutputValue>): InvitationRow {
  return {
    id: text(row, 'id'),
    login: text(row, 'login'),
    invitedBy: optionalText(row, 'invited_by'),
    createdAt: text(row, 'created_at'),
    revokedAt: optionalText(row, 'revoked_at'),
  };
}

function countValue(row: Record<string, SQLOutputValue> | undefined): number {
  const value = row?.['n'];
  if (typeof value !== 'number') {
    throw new Error('count is not a number');
  }
  return value;
}

export function createAccess(db: DatabaseSync, clock: () => Date, ids: () => string): Access {
  const selectById = db.prepare(`${USER_SQL} WHERE id = ?`);
  const selectByLogin = db.prepare(`${USER_SQL} WHERE login = ?`);
  const selectActiveByLogin = db.prepare(`${USER_SQL} WHERE login = ? AND revoked_at IS NULL`);
  const selectUsers = db.prepare(`${USER_SQL} ORDER BY login, id`);
  const selectPendingByLogin = db.prepare(
    `SELECT id, login, invited_by, created_at, revoked_at
     FROM invitations WHERE login = ? AND revoked_at IS NULL ORDER BY id`,
  );
  const selectInvitationById = db.prepare(
    `SELECT id, login, invited_by, created_at, revoked_at FROM invitations WHERE id = ?`,
  );
  const selectPending = db.prepare(
    `SELECT id, login, invited_by, created_at, revoked_at
     FROM invitations WHERE revoked_at IS NULL ORDER BY login, id`,
  );
  const countActiveAdminsStatement = db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND revoked_at IS NULL`,
  );
  const insertUser = db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  const insertInvitation = db.prepare(
    `INSERT INTO invitations (id, login, invited_by, created_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
  );
  const updateDisplayName = db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`);
  const reactivateAsEditor = db.prepare(
    `UPDATE users SET role = 'editor', revoked_at = NULL, display_name = ? WHERE id = ?`,
  );
  const promoteAdmin = db.prepare(`UPDATE users SET role = 'admin', revoked_at = NULL WHERE id = ?`);
  const revokeUserStatement = db.prepare(`UPDATE users SET revoked_at = ? WHERE id = ?`);
  const revokeInvitationStatement = db.prepare(`UPDATE invitations SET revoked_at = ? WHERE id = ?`);
  const setRoleStatement = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);
  const deletePending = db.prepare(`DELETE FROM invitations WHERE login = ? AND revoked_at IS NULL`);

  function transaction<T>(body: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = body();
      db.exec('COMMIT');
      return value;
    } catch (error: unknown) {
      if (db.isTransaction) {
        db.exec('ROLLBACK');
      }
      throw error;
    }
  }

  function userById(id: string): User | undefined {
    const row = selectById.get(id);
    return row === undefined ? undefined : mapUser(row);
  }

  function userByLogin(login: string): User | undefined {
    const row = selectByLogin.get(login);
    return row === undefined ? undefined : mapUser(row);
  }

  function activeUserByLogin(login: string): User | undefined {
    const row = selectActiveByLogin.get(login);
    return row === undefined ? undefined : mapUser(row);
  }

  function pendingByLogin(login: string): InvitationRow | undefined {
    const row = selectPendingByLogin.get(login);
    return row === undefined ? undefined : mapInvitation(row);
  }

  function invitationById(id: string): InvitationRow | undefined {
    const row = selectInvitationById.get(id);
    return row === undefined ? undefined : mapInvitation(row);
  }

  function requireUser(id: string): User {
    const user = userById(id);
    if (user === undefined) {
      throw new Error('user row is missing');
    }
    return user;
  }

  function activeAdmin(actorId: string): User | undefined {
    const actor = userById(actorId);
    if (actor === undefined || actor.revokedAt !== null || actor.role !== 'admin') {
      return undefined;
    }
    return actor;
  }

  function activeAdminCount(): number {
    return countValue(countActiveAdminsStatement.get());
  }

  function timestamp(): string {
    return clock().toISOString();
  }

  return {
    resolve(identity: Identity): { ok: true; user: User } | { ok: false } {
      const active = activeUserByLogin(identity.login);
      if (active !== undefined) {
        if (active.displayName === identity.displayName) {
          return { ok: true, user: active };
        }
        return transaction(() => {
          updateDisplayName.run(identity.displayName, active.id);
          return { ok: true, user: requireUser(active.id) };
        });
      }

      return transaction(() => {
        const current = activeUserByLogin(identity.login);
        if (current !== undefined) {
          return { ok: true, user: current };
        }
        if (pendingByLogin(identity.login) === undefined) {
          return { ok: false };
        }

        const existing = userByLogin(identity.login);
        const userId = existing === undefined ? ids() : existing.id;
        if (existing === undefined) {
          insertUser.run(userId, identity.login, identity.displayName, 'editor', timestamp());
        } else {
          reactivateAsEditor.run(identity.displayName, existing.id);
        }
        deletePending.run(identity.login);
        return { ok: true, user: requireUser(userId) };
      });
    },

    bootstrapAdmin(login: string): 'created' | 'exists' {
      const normalized = normalizeLogin(login);
      if (normalized === undefined) {
        throw new Error('invalid login');
      }
      return transaction(() => {
        if (activeAdminCount() > 0) return 'exists';
        const existing = userByLogin(normalized);
        if (existing !== undefined) {
          promoteAdmin.run(existing.id);
          return 'created';
        }
        insertUser.run(ids(), normalized, normalized, 'admin', timestamp());
        return 'created';
      });
    },

    listUsers(): readonly User[] {
      return selectUsers.all().map((row) => mapUser(row));
    },

    listInvitations(): readonly Invitation[] {
      return selectPending.all().map((row) => {
        const invitation = mapInvitation(row);
        return {
          id: invitation.id,
          login: invitation.login,
          invitedBy: invitation.invitedBy,
          createdAt: invitation.createdAt,
        };
      });
    },

    invite(actorId: string, login: string): AccessResult<Invitation> {
      return transaction(() => {
        if (activeAdmin(actorId) === undefined) return fail('forbidden');
        const normalized = normalizeLogin(login);
        if (normalized === undefined) return fail('invalid_login');
        if (activeUserByLogin(normalized) !== undefined) return fail('already_user');
        if (pendingByLogin(normalized) !== undefined) return fail('already_invited');
        const id = ids();
        const createdAt = timestamp();
        insertInvitation.run(id, normalized, actorId, createdAt);
        const invitation = invitationById(id);
        if (invitation === undefined) {
          throw new Error('invitation insert did not persist');
        }
        return {
          ok: true,
          value: {
            id: invitation.id,
            login: invitation.login,
            invitedBy: invitation.invitedBy,
            createdAt: invitation.createdAt,
          },
        };
      });
    },

    revokeInvitation(actorId: string, invitationId: string): AccessResult<void> {
      return transaction(() => {
        if (activeAdmin(actorId) === undefined) return fail('forbidden');
        const invitation = invitationById(invitationId);
        if (invitation === undefined) return fail('not_found');
        if (invitation.revokedAt !== null) return fail('revoked');
        revokeInvitationStatement.run(timestamp(), invitationId);
        return { ok: true, value: undefined };
      });
    },

    revokeUser(actorId: string, userId: string): AccessResult<void> {
      return transaction(() => {
        if (activeAdmin(actorId) === undefined) return fail('forbidden');
        const target = userById(userId);
        if (target === undefined) return fail('not_found');
        if (target.revokedAt !== null) return fail('revoked');
        if (target.role === 'admin' && activeAdminCount() === 1) return fail('last_admin');
        revokeUserStatement.run(timestamp(), userId);
        return { ok: true, value: undefined };
      });
    },

    setRole(actorId: string, userId: string, role: Role): AccessResult<User> {
      return transaction(() => {
        if (activeAdmin(actorId) === undefined) return fail('forbidden');
        const target = userById(userId);
        if (target === undefined) return fail('not_found');
        if (target.revokedAt !== null) return fail('revoked');
        if (target.role === 'admin' && role === 'editor' && activeAdminCount() === 1) {
          return fail('last_admin');
        }
        setRoleStatement.run(role, userId);
        return { ok: true, value: requireUser(userId) };
      });
    },

    transferAdmin(actorId: string, toUserId: string): AccessResult<void> {
      return transaction(() => {
        const actor = activeAdmin(actorId);
        if (actor === undefined) return fail('forbidden');
        const target = userById(toUserId);
        if (target === undefined) return fail('not_found');
        if (target.revokedAt !== null) return fail('revoked');
        if (target.id === actor.id) return fail('invalid_login');
        setRoleStatement.run('admin', target.id);
        setRoleStatement.run('editor', actor.id);
        return { ok: true, value: undefined };
      });
    },
  };
}
