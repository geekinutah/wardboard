import { describe, expect, it } from 'vitest';
import { accessErrorText, restoreErrorText } from './messages.ts';
import type { AccessErrorCode, RestoreErrorCode } from './types.ts';

describe('accessErrorText', () => {
  const expected: Record<AccessErrorCode, string> = {
    forbidden: 'Only an Admin can do that.',
    not_found: 'That person or invitation no longer exists.',
    invalid_login: 'Enter a valid login.',
    already_user: 'That login already has access.',
    already_invited: 'That login is already invited.',
    last_admin: "You're the only admin. Make someone else an admin first.",
    revoked: "That person's access was already removed.",
    offline: 'Not connected. Try again when the connection is back.',
  };

  it.each(Object.entries(expected) as [AccessErrorCode, string][])(
    'maps %s to exact message',
    (code, expectedMessage) => {
      expect(accessErrorText(code)).toBe(expectedMessage);
    },
  );
});

describe('restoreErrorText', () => {
  const expected: Record<RestoreErrorCode, string> = {
    invalid_archive: 'This file is not a WardBoard backup.',
    corrupt_database: "The backup's database is damaged.",
    incompatible_schema: 'This backup is from an incompatible version of WardBoard.',
    missing_photo: 'The backup is missing photos it refers to.',
    no_admin: 'The backup has no admin, so restoring it would lock everyone out.',
    restore_failed: 'Restore failed. Nothing was changed.',
    too_large: 'The file is too large to be a WardBoard backup.',
    forbidden: 'Only an Admin can restore backups.',
    offline: 'Not connected. Try again when the connection is back.',
  };

  it.each(Object.entries(expected) as [RestoreErrorCode, string][])(
    'maps %s to exact message',
    (code, expectedMessage) => {
      expect(restoreErrorText(code)).toBe(expectedMessage);
    },
  );
});
