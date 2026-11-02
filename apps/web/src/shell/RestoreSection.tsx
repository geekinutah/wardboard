import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button } from '../design/Button.tsx';
import { restoreErrorText } from '../features/settings/messages.ts';
import type { BackupSummary } from '../features/settings/types.ts';
import '../features/settings/settings.css';
import './import-section.css';
import { postRestore } from './restore-client.ts';

function formatCurrentDate(createdAt: string): string {
  const date = new Date(createdAt);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function reloadAfterRestore(): void {
  window.location.assign('/');
}

/** Restore a backup onto a ward that has no Current yet. Admin only. */
export function RestoreSection({ onRestored = reloadAfterRestore }: { onRestored?: () => void }): ReactElement {
  const headingId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [checkingFileName, setCheckingFileName] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ file: File; summary: BackupSummary } | null>(null);
  const [isApplyingRestore, setIsApplyingRestore] = useState(false);
  const [restoreDialogError, setRestoreDialogError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingRestore === null || isApplyingRestore) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setPendingRestore(null);
      setRestoreDialogError(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [pendingRestore, isApplyingRestore]);

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setCheckingFileName(file.name);
    setRestoreError(null);
    try {
      const result = await postRestore('dry-run', file);
      if (result.ok) setPendingRestore({ file, summary: result.summary });
      else setRestoreError(restoreErrorText(result.code));
    } finally {
      setCheckingFileName(null);
    }
  }

  async function applyRestore(): Promise<void> {
    if (pendingRestore === null || isApplyingRestore) return;
    setIsApplyingRestore(true);
    setRestoreDialogError(null);
    try {
      const result = await postRestore('apply', pendingRestore.file);
      if (result.ok) {
        setPendingRestore(null);
        onRestored();
      } else {
        setRestoreDialogError(restoreErrorText(result.code));
      }
    } finally {
      setIsApplyingRestore(false);
    }
  }

  return (
    <section className="wb-import-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="wb-import-section-title">
        Restore a backup
      </h2>
      <p className="wb-import-section-note">
        Replace this empty WardBoard with a backup. Nothing changes until you confirm. Backups include members, photos,
        Current, every proposal, and settings.
      </p>
      <div className="wb-import-section-actions">
        <Button
          variant="secondary"
          disabled={checkingFileName !== null}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          Restore from file…
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".backup,.tar,application/x-tar"
        aria-label="Backup file"
        style={{ display: 'none' }}
        onChange={(event) => {
          void onFile(event);
        }}
      />
      {checkingFileName !== null ? (
        <p role="status" className="wb-import-section-note">
          Checking {checkingFileName}…
        </p>
      ) : null}
      {restoreError !== null && pendingRestore === null ? (
        <p role="alert" className="wb-import-section-error">
          {restoreError}
        </p>
      ) : null}
      {pendingRestore === null ? null : (
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
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h3 id="restore-confirm-dialog-title" className="wb-settings-dialog-title">
              Restore {pendingRestore.file.name}?
            </h3>
            <div className="wb-settings-summary-chips">
              <span className="wb-settings-chip wb-settings-chip-valid">✓ Archive valid</span>
              <span className="wb-settings-chip">{pendingRestore.summary.members} members</span>
              <span className="wb-settings-chip">{pendingRestore.summary.photos} photos</span>
              <span className="wb-settings-chip">{pendingRestore.summary.proposals} proposals</span>
              <span className="wb-settings-chip">{pendingRestore.summary.users} users</span>
              <span className="wb-settings-chip">
                {pendingRestore.summary.hasCurrent
                  ? `Current from ${formatCurrentDate(pendingRestore.summary.createdAt)}`
                  : 'No Current board'}
              </span>
            </div>
            <p className="wb-settings-dialog-text">
              Replaces everything in WardBoard for everyone. Open boards reload. If anything fails, nothing changes.
            </p>
            {restoreDialogError === null ? null : (
              <div role="alert" className="wb-settings-alert">
                {restoreDialogError}
              </div>
            )}
            <div className="wb-settings-dialog-actions">
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-secondary"
                disabled={isApplyingRestore}
                onClick={() => {
                  setPendingRestore(null);
                  setRestoreDialogError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wb-settings-btn wb-settings-btn-danger"
                disabled={isApplyingRestore}
                onClick={() => {
                  void applyRestore();
                }}
              >
                {isApplyingRestore ? 'Restoring…' : 'Replace all data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
