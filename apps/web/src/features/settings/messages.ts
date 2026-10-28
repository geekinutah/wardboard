import { assertNever } from '@wardboard/core';
import type { AccessErrorCode, RestoreErrorCode } from './types.ts';

export function accessErrorText(code: AccessErrorCode): string {
  switch (code) {
    case 'forbidden':
      return 'Only an Admin can do that.';
    case 'not_found':
      return 'That person or invitation no longer exists.';
    case 'invalid_login':
      return 'Enter a valid login.';
    case 'already_user':
      return 'That login already has access.';
    case 'already_invited':
      return 'That login is already invited.';
    case 'last_admin':
      return "You're the only admin. Make someone else an admin first.";
    case 'revoked':
      return "That person's access was already removed.";
    case 'offline':
      return 'Not connected. Try again when the connection is back.';
    default:
      return assertNever(code);
  }
}

export function restoreErrorText(code: RestoreErrorCode): string {
  switch (code) {
    case 'invalid_archive':
      return 'This file is not a WardBoard backup.';
    case 'corrupt_database':
      return "The backup's database is damaged.";
    case 'incompatible_schema':
      return 'This backup is from an incompatible version of WardBoard.';
    case 'missing_photo':
      return 'The backup is missing photos it refers to.';
    case 'no_admin':
      return 'The backup has no admin, so restoring it would lock everyone out.';
    case 'restore_failed':
      return 'Restore failed. Nothing was changed.';
    case 'too_large':
      return 'The file is too large to be a WardBoard backup.';
    case 'forbidden':
      return 'Only an Admin can restore backups.';
    case 'offline':
      return 'Not connected. Try again when the connection is back.';
    default:
      return assertNever(code);
  }
}
