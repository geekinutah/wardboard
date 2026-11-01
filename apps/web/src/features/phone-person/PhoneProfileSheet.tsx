import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { MAX_NOTE_LENGTH } from '@wardboard/core';
import { avatarColor, initials } from '../../design/person.ts';
import { PhotoUpload } from '../photos/PhotoUpload.tsx';
import './phone-person.css';

export interface PhoneProfileMember {
  readonly id: string;
  readonly name: string;
  readonly photoRef: string | null;
  readonly note: string | null;
  readonly category: 'adult' | 'youth';
}

export interface PhoneProfileSheetProps {
  readonly member: PhoneProfileMember;
  readonly currentUrl: string | null;
  readonly onSaveNote: (note: string | null) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly upload: (file: File) => Promise<{ photoRef: string }>;
  readonly assign: (memberId: string, photoRef: string) => Promise<void>;
  readonly onClose: () => void;
}

function CloseIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function categoryLabel(category: PhoneProfileMember['category']): 'Adult' | 'Youth' {
  return category === 'adult' ? 'Adult' : 'Youth';
}

/** Note and portrait for one member. The note is ward data, not a board operation. */
export function PhoneProfileSheet({
  member,
  currentUrl,
  onSaveNote,
  upload,
  assign,
  onClose,
}: PhoneProfileSheetProps): ReactElement {
  const titleId = useId();
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef(false);
  const [value, setValue] = useState(member.note ?? '');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useLayoutEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const trimmed = value.trim();
  const original = (member.note ?? '').trim();
  const count = Array.from(trimmed).length;
  const overLimit = count > MAX_NOTE_LENGTH;
  const unchanged = trimmed === original;
  const saveDisabled = pending || overLimit || unchanged;

  function submit(): void {
    if (pendingRef.current || saveDisabled) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    const note = trimmed === '' ? null : trimmed;
    void onSaveNote(note).then(
      (result) => {
        if (result.ok) {
          onClose();
          return;
        }
        setFailure(result.message);
        pendingRef.current = false;
        setPending(false);
      },
      () => {
        pendingRef.current = false;
        setPending(false);
      },
    );
  }

  return (
    <>
      <div className="wb-phone-sheet-scrim wb-phone-profile-scrim" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="wb-phone-sheet-dialog wb-phone-profile"
      >
        <span className="wb-phone-sheet-handle" aria-hidden="true" />
        <div className="wb-phone-profile-head">
          {member.photoRef === null ? (
            <span
              className="wb-phone-person-avatar"
              style={{ backgroundColor: avatarColor(member.name) }}
              aria-hidden="true"
            >
              {initials(member.name)}
            </span>
          ) : (
            <img className="wb-phone-profile-photo" alt={member.name} src={currentUrl ?? ''} />
          )}
          <div className="wb-phone-profile-id">
            <h2 id={titleId} className="wb-phone-profile-name">{`Profile · ${member.name}`}</h2>
            <p className="wb-phone-profile-category">{categoryLabel(member.category)}</p>
          </div>
          <button type="button" className="wb-phone-sheet-close-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <PhotoUpload
          member={{ id: member.id, name: member.name, photoRef: member.photoRef }}
          currentUrl={currentUrl}
          upload={upload}
          assign={assign}
        />
        <p className="wb-phone-profile-shared">
          Notes are shared across Current and every proposal. They never appear on the TV or in search.
        </p>
        <div className="wb-phone-profile-field">
          <label className="wb-phone-profile-label" htmlFor={fieldId}>
            Note
          </label>
          <textarea
            id={fieldId}
            ref={fieldRef}
            className="wb-phone-profile-note"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <p className="wb-phone-profile-count">{`${String(count)} / ${String(MAX_NOTE_LENGTH)}`}</p>
          {overLimit ? <p className="wb-phone-profile-limit">Notes can be at most {MAX_NOTE_LENGTH} characters.</p> : null}
          {failure === null ? null : (
            <p className="wb-phone-profile-error" role="alert">{`Could not save the note: ${failure}`}</p>
          )}
        </div>
        <div className="wb-phone-profile-actions">
          <button type="button" className="wb-phone-profile-save" disabled={saveDisabled} onClick={submit}>
            Save
          </button>
          <button type="button" className="wb-phone-profile-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
