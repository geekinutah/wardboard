import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, SyntheticEvent } from 'react';
import type { TagId, TagUsage, Ward } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { ErrorLine, useAction } from './shared.tsx';
import { deleteConfirmation, memberCountByTag } from './tag-model.ts';

export interface TagLibraryProps {
  ward: Ward;
  usageOf: (tagId: TagId) => TagUsage | null;
  /** Called once each time a delete dialog opens, so the caller can fetch the counts. */
  onDeleteRequested?: (tagId: TagId) => void;
  /** A message when counting the tag's usage failed; shown in the dialog, and Delete stays disabled. */
  usageErrorOf?: (tagId: TagId) => string | null;
  onCreateTag: (name: string) => Promise<RequestResult<{ tagId: TagId }>>;
  onDeleteTag: (tagId: TagId) => Promise<RequestResult>;
}

function NewTagForm({
  ward,
  onCreateTag,
  onClose,
}: {
  ward: Ward;
  onCreateTag: TagLibraryProps['onCreateTag'];
  onClose: () => void;
}): ReactElement {
  const action = useAction();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The form opens from the user's own click on "+ New tag", so it takes focus.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setProblem('Enter a tag name.');
      return;
    }
    const lower = trimmed.toLowerCase();
    if (Object.values(ward.tags).some((tag) => tag.name.toLowerCase() === lower)) {
      setProblem(`A tag named “${trimmed}” already exists.`);
      return;
    }
    setProblem(null);
    void action.run(() => onCreateTag(trimmed)).then((ok) => {
      if (ok) {
        onClose();
      }
    });
  };

  return (
    <form className="wb-tags-newform" onSubmit={submit}>
      <input
        type="text"
        className="wb-tags-input"
        aria-label="New tag name"
        autoComplete="off"
        ref={inputRef}
        value={name}
        disabled={action.pending}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
          }
        }}
      />
      <button type="submit" className="wb-tags-small-button wb-tags-small-button-primary" disabled={action.pending}>
        Save
      </button>
      <button type="button" className="wb-tags-small-button" onClick={onClose}>
        Cancel
      </button>
      <ErrorLine message={problem ?? action.error} />
    </form>
  );
}

function DeleteDialog({
  name,
  usage,
  usageError,
  onCancel,
  onDelete,
}: {
  name: string;
  usage: TagUsage | null;
  usageError: string | null;
  onCancel: () => void;
  onDelete: () => Promise<RequestResult>;
}): ReactElement {
  const titleId = useId();
  const action = useAction();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const copy =
    usage === null ? { title: `Delete “${name}”?`, body: "Counting where it's used…" } : deleteConfirmation(name, usage);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="wb-tags-scrim">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="wb-tags-dialog"
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId} className="wb-tags-dialog-title">
          {copy.title}
        </h3>
        {usage === null && usageError !== null ? (
          <p className="wb-tags-error" role="alert">
            {`Couldn't count where it's used: ${usageError}`}
          </p>
        ) : (
          <p className="wb-tags-dialog-body">{copy.body}</p>
        )}
        <ErrorLine message={action.error} />
        <div className="wb-tags-dialog-actions">
          <button ref={cancelRef} type="button" className="wb-tags-dialog-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="wb-tags-dialog-button wb-tags-dialog-button-danger"
            disabled={action.pending || usage === null}
            onClick={() => {
              void action.run(onDelete).then((ok) => {
                if (ok) {
                  onCancel();
                }
              });
            }}
          >
            Delete tag
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ward-wide tag list with usage, creation, and delete-after-confirmation (SPEC §6). */
export function TagLibrary({
  ward,
  usageOf,
  onCreateTag,
  onDeleteTag,
  onDeleteRequested,
  usageErrorOf,
}: TagLibraryProps): ReactElement {
  const headingId = useId();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TagId | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const counts = memberCountByTag(ward);
  const tags = Object.values(ward.tags).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const target = deleting === null ? undefined : ward.tags[deleting];

  const closeDialog = (): void => {
    setDeleting(null);
    opener.current?.focus();
    opener.current = null;
  };

  return (
    <section className="wb-tags-card" aria-labelledby={headingId}>
      <div className="wb-tags-library-head">
        <h2 id={headingId} className="wb-tags-title">
          Tag library
        </h2>
        {creating ? null : (
          <button
            type="button"
            className="wb-tags-small-button"
            onClick={() => {
              setCreating(true);
            }}
          >
            + New tag
          </button>
        )}
      </div>
      {creating ? (
        <NewTagForm
          ward={ward}
          onCreateTag={onCreateTag}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}

      {tags.length === 0 ? (
        <p className="wb-tags-note">No tags yet.</p>
      ) : (
        <table className="wb-tags-table">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Used</th>
              <th scope="col">
                <span className="wb-tags-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td className="wb-tags-table-name">{tag.name}</td>
                <td className="wb-tags-table-used">{counts[tag.id] ?? 0}</td>
                <td className="wb-tags-table-actions">
                  <button
                    type="button"
                    className="wb-tags-row-delete"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setDeleting(tag.id);
                      onDeleteRequested?.(tag.id);
                    }}
                  >
                    Delete <span className="wb-tags-sr">{tag.name}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {target !== undefined ? (
        <DeleteDialog
          name={target.name}
          usage={usageOf(target.id)}
          usageError={usageErrorOf?.(target.id) ?? null}
          onCancel={closeDialog}
          onDelete={() => onDeleteTag(target.id)}
        />
      ) : null}
    </section>
  );
}
