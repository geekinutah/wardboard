export type Role = 'editor' | 'admin';

export type AccessUser = {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  createdAt: string;
  revokedAt: string | null;
};

export type AccessInvitation = {
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
  | 'revoked'
  | 'offline';

export type ActionResult = { ok: true } | { ok: false; code: AccessErrorCode };

export type BackupSummary = {
  createdAt: string;
  schemaVersion: number;
  members: number;
  proposals: number;
  users: number;
  photos: number;
  hasCurrent: boolean;
};

export type RestoreErrorCode =
  | 'invalid_archive'
  | 'corrupt_database'
  | 'incompatible_schema'
  | 'missing_photo'
  | 'no_admin'
  | 'restore_failed'
  | 'too_large'
  | 'forbidden'
  | 'offline';

export type RestoreResult = { ok: true; summary: BackupSummary } | { ok: false; code: RestoreErrorCode };

export interface SettingsActions {
  invite(login: string): Promise<ActionResult>;
  revokeInvitation(invitationId: string): Promise<ActionResult>;
  revokeUser(userId: string): Promise<ActionResult>;
  setRole(userId: string, role: Role): Promise<ActionResult>;
  transferAdmin(toUserId: string): Promise<ActionResult>;
  setShowNeedsApproval(value: boolean): Promise<ActionResult>;
  validateRestore(file: File): Promise<RestoreResult>;
  applyRestore(file: File): Promise<RestoreResult>;
}

export type Me = {
  login: string;
  displayName: string;
  role: Role;
};

export type AccessData = {
  users: readonly AccessUser[];
  invitations: readonly AccessInvitation[];
};
