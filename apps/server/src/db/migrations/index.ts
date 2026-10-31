import type { Migration } from '../types.ts';
import { initialMigration } from './001-initial.ts';
import { boardPersistenceMigration } from './002-board-persistence.ts';
import { genderMigration } from './003-gender.ts';

export const migrations: readonly Migration[] = [
  initialMigration,
  boardPersistenceMigration,
  genderMigration,
];
