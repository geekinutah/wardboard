import path from 'node:path';

export { migrate } from './migrate.ts';
export { migrations } from './migrations/index.ts';
export { openDatabase } from './open.ts';
export type { Clock, Migration } from './types.ts';

export function databasePath(dataDir: string): string {
  return path.join(dataDir, 'wardboard.sqlite');
}
