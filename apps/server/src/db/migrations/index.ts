import type { Migration } from '../types.ts';
import { initialMigration } from './001-initial.ts';

export const migrations: readonly Migration[] = [initialMigration];
