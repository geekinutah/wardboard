import { useEffect, useId, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { accessErrorText, restoreErrorText } from './messages.ts';
import type { AccessData, AccessUser, BackupSummary, Me, Role, SettingsActions } from './types.ts';
import './settings.css';

export interface SettingsPageProps {
  me: Me;
  access: AccessData | null;
  showNeedsApproval: boolean;
  backupUrl: string;
  actions: SettingsActions;
  onBack: () => void;
  onRestored: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  if (!last) return first.slice(0, 2).toUpperCase();
  const c1 = first[0] ?? '';
  const c2 = last[0] ?? '';
  return (c1 + c2).toUpperCase() || '?';
}

function formatCurrentDate(createdAt: string): string {
  const date = new Date(createdAt);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function SettingsPage({
  me,
  access,
  showNeedsApproval,
  backupUrl,
  actions,
  onBack,
  onRestored,
}: SettingsPageProps): ReactElement {
  const isAdmin = me.role === 'admin';

  // State for invite form
  const [inviteLogin, setInviteLogin] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  // General access error (in People & access section)
  const [accessError, setAccessError] = useState<string | null>(null);

  // Pending user or invitation row action
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  // Dialogs
  const [userToRemove, setUserToRemove] = useState<AccessUser | null>(null);
  const [isRemovingUser, setIsRemovingUser] = useState(false);

  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  // Presentation switch pending
  const [isTogglingApproval, setIsTogglingApproval] = useState(false);

  // Backup & restore state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [checkingFileName, setCheckingFileName] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{ file: File; summary: BackupSummary } | null>(null);
  const [isApplyingRestore, setIsApplyingRestore] = useState(false);
  const [restoreDialogError, setRestoreDialogError] = useState<string | null>(null);

  // Escape key handler for dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (userToRemove) {
          setUserToRemove(null);
        } else if (showTransferDialog) {
          setShowTransferDialog(false);
          setSelectedTransferTarget(null);
        } else if (pendingRestore && !isApplyingRestore) {
          setPendingRestore(null);
          setRestoreDialogError(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [userToRemove, showTransferDialog, pendingRestore, isApplyingRestore]);

  // Active users & sole admin calculation
  const activeUsers = access ? access.users.filter((u) => u.revokedAt === null) : [];
  const sortedUsers = [...activeUsers].sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === 'admin' ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName, 'en');
  });

  const sortedInvitations = access
    ? [...access.invitations].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];

  const activeAdminsCount = activeUsers.filter((u) => u.role === 'admin').length;
  const isSoleAdmin = activeAdminsCount <= 1;

  // Handlers for People & access
  const handleInvite = async (e: SyntheticEvent) => {
    e.preventDefault();
    const trimmed = inviteLogin.trim();
    if (!trimmed || isInviting) return;

    setIsInviting(true);
    setAccessError(null);
    try {
      const result = await actions.invite(trimmed);
      if (result.ok) {
        setInviteLogin('');
      } else {
        setAccessError(accessErrorText(result.code));
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleSetRole = async (userId: string, newRole: Role) => {
    if (pendingRowId !== null) return;
    setPendingRowId(userId);
    setAccessError(null);
    try {
      const result = await actions.setRole(userId, newRole);
      if (!result.ok) {
        setAccessError(accessErrorText(result.code));
      }
    } finally {
      setPendingRowId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!userToRemove || isRemovingUser) return;
    setIsRemovingUser(true);
    setAccessError(null);
    try {
      const result = await actions.revokeUser(userToRemove.id);
      if (result.ok) {
        setUserToRemove(null);
      } else {
        setUserToRemove(null);
        setAccessError(accessErrorText(result.code));
      }
    } finally {
      setIsRemovingUser(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (pendingRowId !== null) return;
    setPendingRowId(invitationId);
    setAccessError(null);
    try {
      const result = await actions.revokeInvitation(invitationId);
      if (!result.ok) {
        setAccessError(accessErrorText(result.code));
      }
    } finally {
      setPendingRowId(null);
    }
  };

  const handleTransferAdmin = async () => {
    if (!selectedTransferTarget || isTransferring) return;
    setIsTransferring(true);
    setAccessError(null);
    try {
      const result = await actions.transferAdmin(selectedTransferTarget);
      if (result.ok) {
        setShowTransferDialog(false);
        setSelectedTransferTarget(null);
      } else {
        setShowTransferDialog(false);
        setSelectedTransferTarget(null);
        setAccessError(accessErrorText(result.code));
      }
    } finally {
      setIsTransferring(false);
    }
  };

  // Handler for Presentation switch
  const handleToggleNeedsApproval = async () => {
    if (!isAdmin || isTogglingApproval) return;
    setIsTogglingApproval(true);
    try {
      await actions.setShowNeedsApproval(!showNeedsApproval);
    } finally {
      setIsTogglingApproval(false);
    }
  };

  // Handlers for Backup & restore
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setCheckingFileName(file.name);
    setRestoreError(null);
    setRestoreSuccess(false);

    try {
      const result = await actions.validateRestore(file);
      if (result.ok) {
        setPendingRestore({ file, summary: result.summary });
      } else {
        setRestoreError(restoreErrorText(result.code));
      }
    } finally {
      setCheckingFileName(null);
    }
  };

  const handleApplyRestore = async () => {
    if (!pendingRestore || isApplyingRestore) return;
    setIsApplyingRestore(true);
    setRestoreDialogError(null);

    try {
      const result = await actions.applyRestore(pendingRestore.file);
      if (result.ok) {
        setPendingRestore(null);
        setRestoreSuccess(true);
        onRestored();
      } else {
        setRestoreDialogError(restoreErrorText(result.code));
      }
    } finally {
      setIsApplyingRestore(false);
    }
  };

  const switchLabelId = useId();

  return (
    <main aria-labelledby="settings-heading" className="wb-settings-page">
      <div className="wb-settings-container">
        {/* Navigation Sidebar */}
        <nav aria-label="Settings" className="wb-settings-nav">
          <button
            type="button"
            className="wb-settings-back-link"
            onClick={() => {
              onBack();
            }}
          >
            ← Back to board
          </button>
          <h1 id="settings-heading" className="wb-settings-title">
            Settings
          </h1>
          <a href="#access" className="wb-settings-nav-item">
            People &amp; access
          </a>
          <a href="#presentation" className="wb-settings-nav-item">
            Presentation
          </a>
          <a href="#backup" className="wb-settings-nav-item">
            Backup &amp; restore
          </a>
        </nav>

        {/* Main Content Area */}
        <div className="wb-settings-main">
          {/* Section 1: People & access */}
          <section id="access" aria-labelledby="access-heading" className="wb-settings-card">
            <div className="wb-settings-section-header">
              <div className="wb-settings-header-text">
                <h2 id="access-heading" className="wb-settings-section-title">
                  People &amp; access
                </h2>
                {isAdmin ? (
                  <span className="wb-settings-section-sub">
                    Everyone invited can edit every proposal. Admins also manage access.
                  </span>
                ) : null}
              </div>

              {isAdmin ? (
                <form
                  onSubmit={(e) => {
                    void handleInvite(e);
                  }}
                  className="wb-settings-invite-form"
                >
                  <label htmlFor="invite-login" className="wb-settings-invite-label">
                    Login to invite
                  </label>
                  <input
                    id="invite-login"
                    type="text"
                    className="wb-settings-input"
                    value={inviteLogin}
                    onChange={(e) => {
                      setInviteLogin(e.target.value);
                    }}
                    placeholder="name@example.test"
                    disabled={isInviting}
                  />
                  <button
                    type="submit"
                    className="wb-settings-btn wb-settings-btn-primary"
                    disabled={inviteLogin.trim().length === 0 || isInviting}
                  >
                    {isInviting ? 'Inviting…' : 'Invite editor'}
                  </button>
                </form>
              ) : null}
            </div>

            {!isAdmin ? (
              <p className="wb-settings-editor-note">Only an Admin can manage access.</p>
            ) : access === null ? (
              <p className="wb-settings-editor-note">Loading people…</p>
            ) : (
              <>
                {accessError ? (
                  <div role="alert" className="wb-settings-alert">
                    {accessError}
                  </div>
                ) : null}

                <div className="wb-settings-table-wrapper">
                  <div className="wb-settings-table">
                    {/* Active users */}
                    {sortedUsers.map((user) => {
                      const isMe = user.login === me.login;
                      const isRowPending = pendingRowId === user.id;

                      return (
                        <div key={user.id} className="wb-settings-row">
                          <span className="wb-settings-avatar">
                            {getInitials(user.displayName)}
                          </span>
                          <span className="wb-settings-user-info">
                            <span className="wb-settings-user-name">
                              {user.displayName}
                              {isMe ? ' (you)' : ''}
                            </span>
                            <span className="wb-settings-user-login">{user.login}</span>
                          </span>
                          <span
                            className={`wb-settings-role-badge ${
                              user.role === 'admin'
                                ? 'wb-settings-role-admin'
                                : 'wb-settings-role-editor'
                            }`}
                          >
                            {user.role === 'admin' ? 'Admin' : 'Editor'}
                          </span>

                          <div className="wb-settings-row-actions">
                            {isMe ? (
                              <>
                                {activeUsers.length > 1 ? (
                                  <button
                                    type="button"
                                    className="wb-settings-row-btn"
                                    onClick={() => {
                                      setShowTransferDialog(true);
                                    }}
                                    disabled={isRowPending}
                                  >
                                    Transfer admin
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  className="wb-settings-row-btn"
                                  onClick={() => {
                                    void handleSetRole(user.id, 'editor');
                                  }}
                                  disabled={isSoleAdmin || isRowPending}
                                >
                                  Make editor
                                </button>

                                <button
                                  type="button"
                                  className="wb-settings-row-btn"
                                  onClick={() => {
                                    setUserToRemove(user);
                                  }}
                                  disabled={isSoleAdmin || isRowPending}
                                >
                                  Remove access
                                </button>
                              </>
                            ) : (
                              <>
                                {user.role === 'editor' ? (
                                  <button
                                    type="button"
                                    className="wb-settings-row-btn"
                                    onClick={() => {
                                      void handleSetRole(user.id, 'admin');
                                    }}
                                    disabled={isRowPending}
                                  >
                                    Make admin
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="wb-settings-row-btn"
                                    onClick={() => {
                                      void handleSetRole(user.id, 'editor');
                                    }}
                                    disabled={isRowPending}
                                  >
                                    Make editor
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="wb-settings-row-btn"
                                  onClick={() => {
                                    setUserToRemove(user);
                                  }}
                                  disabled={isRowPending}
                                >
                                  Remove access
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Invitations */}
                    {sortedInvitations.map((inv) => {
                      const isRowPending = pendingRowId === inv.id;

                      return (
                        <div key={inv.id} className="wb-settings-row">
                          <span className="wb-settings-avatar">?</span>
                          <span className="wb-settings-user-info">
                            <span className="wb-settings-user-name">{inv.login}</span>
                            <span className="wb-settings-user-login">Invitation pending</span>
                          </span>
                          <span className="wb-settings-role-badge wb-settings-role-invited">
                            Invited
                          </span>
                          <div className="wb-settings-row-actions">
                            <button
                              type="button"
                              className="wb-settings-row-btn"
                              onClick={() => {
                                void handleRevokeInvitation(inv.id);
                              }}
                              disabled={isRowPending}
                            >
                              Revoke
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {isSoleAdmin ? (
                  <div className="wb-settings-callout">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#3A444F"
                      strokeWidth="2"
                      aria-hidden="true"
                      className="wb-settings-callout-icon"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v5M12 16h.01" />
                    </svg>
                    <span>
                      You&apos;re the only admin, so you can&apos;t remove your own admin role or
                      access. Make someone else an admin first, or use Transfer admin.
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </section>

          {/* Section 2: Presentation */}
          <section
            id="presentation"
            aria-labelledby="presentation-heading"
            className="wb-settings-card"
          >
            <h2 id="presentation-heading" className="wb-settings-section-title">
              Presentation
            </h2>
            <div className="wb-settings-switch-row">
              <div className="wb-settings-header-text">
                <span id={switchLabelId} className="wb-settings-switch-title">
                  Show Needs approval
                  <span className="wb-settings-badge-admin">Admins only</span>
                </span>
                <span className="wb-settings-switch-desc">
                  Off by default. Only an Admin can change this.
                </span>
              </div>
              <div className="wb-settings-switch-control">
                <span className="wb-settings-switch-state">
                  {showNeedsApproval ? 'On' : 'Off'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-labelledby={switchLabelId}
                  aria-checked={showNeedsApproval}
                  aria-disabled={!isAdmin ? 'true' : undefined}
                  disabled={!isAdmin || isTogglingApproval}
                  onClick={
                    isAdmin
                      ? () => {
                          void handleToggleNeedsApproval();
                        }
                      : undefined
                  }
                  className={`wb-settings-switch ${
                    showNeedsApproval ? 'wb-settings-switch--checked' : ''
                  }`}
                >
                  <span className="wb-settings-switch-thumb" />
                </button>
              </div>
            </div>
          </section>

          {/* Section 3: Backup & restore */}
          <section id="backup" aria-labelledby="backup-heading" className="wb-settings-card">
            <div className="wb-settings-section-header">
              <div className="wb-settings-header-text">
                <h2 id="backup-heading" className="wb-settings-section-title">
                  Backup &amp; restore
                </h2>
                {isAdmin ? (
                  <span className="wb-settings-section-sub">
                    Backups include members, photos, Current, every proposal and settings. Treat
                    them as confidential.
                  </span>
                ) : null}
              </div>

              {isAdmin ? (
                <div className="wb-settings-backup-buttons">
                  <button
                    type="button"
                    className="wb-settings-btn wb-settings-btn-secondary"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    disabled={checkingFileName !== null}
                  >
                    Restore from file…
                  </button>
                  <a href={backupUrl} download className="wb-settings-btn wb-settings-btn-primary">
                    Create backup
                  </a>
                </div>
              ) : null}
            </div>

            {!isAdmin ? (
              <p className="wb-settings-editor-note">
                Only an Admin can create or restore backups.
              </p>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".backup,.tar,application/x-tar"
                  aria-label="Backup file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleFileChange(e);
                  }}
                />

                {checkingFileName ? (
                  <div role="status" className="wb-settings-status">
                    Checking {checkingFileName}…
                  </div>
                ) : null}

                {restoreError && !pendingRestore ? (
                  <div role="alert" className="wb-settings-alert">
                    {restoreError}
                  </div>
                ) : null}

                {restoreSuccess ? (
                  <div role="status" className="wb-settings-status">
                    Restore complete.
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>

      {/* Remove Access Confirmation Dialog */}
      {userToRemove ? (
        <div
          className="wb-settings-backdrop"
          onClick={() => {
            setUserToRemove(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-access-dialog-title"
            className="wb-settings-dialog"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 id="remove-access-dialog-title" className="wb-settings-dialog-title">
              Remove access for {userToRemove.displayName}?
            </h3>
            <p className="wb-settings-dialog-text">
              They will be signed out right away and can no longer open WardBoard.
            </p>
            <div className="wb-settings-dialog-actions">
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-secondary"
                onClick={() => {
                  setUserToRemove(null);
                }}
                disabled={isRemovingUser}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-danger"
                onClick={() => {
                  void handleConfirmRemove();
                }}
                disabled={isRemovingUser}
              >
                {isRemovingUser ? 'Removing…' : 'Remove access'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Transfer Admin Confirmation Dialog */}
      {showTransferDialog ? (
        <div
          className="wb-settings-backdrop"
          onClick={() => {
            setShowTransferDialog(false);
            setSelectedTransferTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-admin-dialog-title"
            className="wb-settings-dialog"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 id="transfer-admin-dialog-title" className="wb-settings-dialog-title">
              Transfer admin
            </h3>
            <div className="wb-settings-radio-list">
              {activeUsers
                .filter((u) => u.login !== me.login)
                .map((u) => (
                  <label key={u.id} className="wb-settings-radio-label">
                    <input
                      type="radio"
                      name="transfer-target"
                      value={u.id}
                      checked={selectedTransferTarget === u.id}
                      onChange={() => {
                        setSelectedTransferTarget(u.id);
                      }}
                      disabled={isTransferring}
                    />
                    Make {u.displayName} the admin
                  </label>
                ))}
            </div>
            <div className="wb-settings-dialog-actions">
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-secondary"
                onClick={() => {
                  setShowTransferDialog(false);
                  setSelectedTransferTarget(null);
                }}
                disabled={isTransferring}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-primary"
                onClick={() => {
                  void handleTransferAdmin();
                }}
                disabled={!selectedTransferTarget || isTransferring}
              >
                {isTransferring ? 'Transferring…' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Restore Confirmation Dialog */}
      {pendingRestore ? (
        <div
          className="wb-settings-backdrop"
          onClick={() => {
            if (!isApplyingRestore) {
              setPendingRestore(null);
              setRestoreDialogError(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-confirm-dialog-title"
            className="wb-settings-dialog"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 id="restore-confirm-dialog-title" className="wb-settings-dialog-title">
              Restore {pendingRestore.file.name}?
            </h3>

            <div className="wb-settings-summary-chips">
              <span className="wb-settings-chip wb-settings-chip-valid">✓ Archive valid</span>
              <span className="wb-settings-chip">{pendingRestore.summary.members} members</span>
              <span className="wb-settings-chip">{pendingRestore.summary.photos} photos</span>
              <span className="wb-settings-chip">
                {pendingRestore.summary.proposals} proposals
              </span>
              <span className="wb-settings-chip">{pendingRestore.summary.users} users</span>
              <span className="wb-settings-chip">
                {pendingRestore.summary.hasCurrent
                  ? `Current from ${formatCurrentDate(pendingRestore.summary.createdAt)}`
                  : 'No Current board'}
              </span>
            </div>

            <p className="wb-settings-dialog-text">
              Replaces everything in WardBoard for everyone. Open boards reload. If anything
              fails, nothing changes.
            </p>

            {restoreDialogError ? (
              <div role="alert" className="wb-settings-alert">
                {restoreDialogError}
              </div>
            ) : null}

            <div className="wb-settings-dialog-actions">
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-secondary"
                onClick={() => {
                  setPendingRestore(null);
                  setRestoreDialogError(null);
                }}
                disabled={isApplyingRestore}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-danger"
                onClick={() => {
                  void handleApplyRestore();
                }}
                disabled={isApplyingRestore}
              >
                {isApplyingRestore ? 'Restoring…' : 'Replace all data'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
