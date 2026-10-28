import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { MAX_NOTE_LENGTH, type Member, type MemberId } from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import './person.css';

export type NoteSaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface NotesDialogProps {
  readonly member: Member;
  readonly onSave: (memberId: MemberId, note: string | null) => Promise<NoteSaveResult>;
  readonly onClose: () => void;
}

export function NotesDialog({ member, onSave, onClose }: NotesDialogProps): ReactElement {
  const headingId = useId();
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
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
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
    if (pendingRef.current || saveDisabled) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    const note = trimmed === '' ? null : trimmed;
    void onSave(member.id, note).then(
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
    <div className="wb-notes-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="wb-notes-dialog">
        <h2 id={headingId} className="wb-notes-title">{`Notes · ${member.name}`}</h2>
        <p className="wb-notes-shared">
          Notes are shared across Current and every proposal. They never appear on the TV or in search.
        </p>
        <div className="wb-notes-field">
          <label className="wb-notes-label" htmlFor={fieldId}>
            Note
          </label>
          <textarea
            id={fieldId}
            ref={fieldRef}
            className="wb-notes-input"
            value={value}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <p className="wb-notes-count">{`${String(count)} / ${String(MAX_NOTE_LENGTH)}`}</p>
          {overLimit ? <p className="wb-notes-limit">Notes can be at most {MAX_NOTE_LENGTH} characters.</p> : null}
          {failure === null ? null : (
            <p className="wb-notes-error" role="alert">{`Could not save the note: ${failure}`}</p>
          )}
        </div>
        <div className="wb-notes-actions">
          <Button type="button" variant="primary" disabled={saveDisabled} onClick={submit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
