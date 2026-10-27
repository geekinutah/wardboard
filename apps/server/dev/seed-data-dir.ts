import { mkdirSync } from 'node:fs';
import { databasePath, migrate, openDatabase } from '../src/db/index.ts';
import { openStore } from '../src/store/index.ts';
import { seedFixture } from './seed-fixture.ts';

export type SeededState = 'seeded' | 'existing';

/**
 * Seeds the fictional fixture ward into the database under `dataDir`.
 *
 * Creates `dataDir` if missing, opens `databasePath(dataDir)` and migrates it,
 * then — with a real clock — seeds the fixture ward only when no Current board
 * exists yet. An already-initialized data dir is left untouched and reported
 * as `'existing'`; the database is always closed.
 */
export function seedFixtureDataDir(dataDir: string): SeededState {
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(databasePath(dataDir));
  try {
    migrate(db);
    const store = openStore(db, () => new Date());
    if (store.loadCurrent() === null) {
      seedFixture(store);
      return 'seeded';
    }
    return 'existing';
  } finally {
    db.close();
  }
}
