import { DatabaseSync } from 'node:sqlite';
import { migrations as allMigrations } from './migrations/index.ts';
import type { Clock, Migration } from './types.ts';

const CREATE_SCHEMA_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
`;

export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = allMigrations,
  clock: Clock = () => new Date(),
): void {
  assertStrictlyIncreasing(migrations);
  db.exec(CREATE_SCHEMA_MIGRATIONS);

  const applied = readAppliedIds(db);
  const known = new Set(migrations.map((migration) => migration.id));
  const unknown = [...applied].filter((id) => !known.has(id)).sort((left, right) => left - right);
  if (unknown.length > 0) {
    throw new Error(`Unknown applied migration id: ${unknown.join(', ')}`);
  }

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    applyMigration(db, migration, clock);
  }
}

function assertStrictlyIncreasing(list: readonly Migration[]): void {
  for (let index = 1; index < list.length; index += 1) {
    const previous = list[index - 1];
    const current = list[index];
    if (previous === undefined || current === undefined) {
      throw new Error('Migration list is missing an entry');
    }
    if (current.id <= previous.id) {
      throw new Error(
        `Migration ids must be strictly increasing: ${String(previous.id)} then ${String(current.id)}`,
      );
    }
  }
}

function readAppliedIds(db: DatabaseSync): Set<number> {
  const ids = new Set<number>();
  for (const row of db.prepare('SELECT id FROM schema_migrations').all()) {
    const id = row['id'];
    if (typeof id !== 'number') {
      throw new Error('schema_migrations.id must be a number');
    }
    ids.add(id);
  }
  return ids;
}

function applyMigration(db: DatabaseSync, migration: Migration, clock: Clock): void {
  db.exec('BEGIN');
  try {
    db.exec(migration.up);
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
      migration.id,
      migration.name,
      clock().toISOString(),
    );
    db.exec('COMMIT');
  } catch (error: unknown) {
    let rollbackNote = '';
    if (db.isTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError: unknown) {
        rollbackNote = ` (rollback failed: ${errorText(rollbackError)})`;
      }
    }
    throw new Error(
      `Migration ${String(migration.id)} (${migration.name}) failed: ${errorText(error)}${rollbackNote}`,
      { cause: error },
    );
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
