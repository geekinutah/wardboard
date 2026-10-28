import { useEffect, useId, useRef, useState, type ReactElement, type SubmitEvent } from 'react';
import { assertNever, type ProposalStatus } from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { cx } from '../../design/cx.ts';
import { formatImportDate } from './import-date.ts';
import './proposals.css';

export type StartProposalSource =
  | { readonly kind: 'current' }
  | { readonly kind: 'proposal'; readonly proposalId: string };

/** Server `createProposal` body without `type` and `requestId`. */
export type CreateProposalRequest = {
  readonly name: string;
  readonly rationale: string | null;
  readonly source: StartProposalSource;
};

export type StartProposalChoice = {
  readonly id: string;
  readonly name: string;
  readonly status: ProposalStatus;
  readonly tabOrder: number;
};

export type CreateProposalResult = { ok: true } | { ok: false; message: string };

export type StartProposalDialogProps = {
  readonly importedAt: string;
  readonly proposals: readonly StartProposalChoice[];
  readonly initialSource?: StartProposalSource;
  readonly onCreate: (request: CreateProposalRequest) => Promise<CreateProposalResult>;
  readonly onClose: () => void;
};

const NAME_LIMIT = 80;
const RATIONALE_LIMIT = 500;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function resolveSource(
  proposals: readonly StartProposalChoice[],
  initialSource: StartProposalSource | undefined,
): StartProposalSource {
  if (initialSource === undefined || initialSource.kind === 'current') {
    return { kind: 'current' };
  }
  const known = proposals.some((proposal) => proposal.id === initialSource.proposalId);
  if (!known) return { kind: 'current' };
  return { kind: 'proposal', proposalId: initialSource.proposalId };
}

function duplicateDetail(status: ProposalStatus): string {
  const base = 'Copies its arrangement; keeps its original baseline';
  switch (status) {
    case 'draft':
      return base;
    case 'accepted':
      return `${base} · Accepted`;
    default:
      return assertNever(status);
  }
}

function currentDetail(importedAt: string): string {
  const date = formatImportDate(importedAt);
  if (date === null) return "Baseline is today's Current (import date unknown)";
  return `Baseline is today's Current (${date} import)`;
}

export function StartProposalDialog({
  importedAt,
  proposals,
  initialSource,
  onCreate,
  onClose,
}: StartProposalDialogProps): ReactElement {
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const nameId = `${idPrefix}-name`;
  const nameErrorId = `${idPrefix}-name-error`;
  const rationaleId = `${idPrefix}-rationale`;
  const rationaleErrorId = `${idPrefix}-rationale-error`;
  const currentDetailId = `${idPrefix}-current-detail`;
  const radioName = `${idPrefix}-source`;
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const [name, setName] = useState('');
  const [rationale, setRationale] = useState('');
  const [source, setSource] = useState<StartProposalSource>(() => resolveSource(proposals, initialSource));
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const ordered = [...proposals].sort((left, right) => left.tabOrder - right.tabOrder);
  const trimmedName = name.trim();
  const trimmedRationale = rationale.trim();
  const nameLength = codePointLength(trimmedName);
  const rationaleLength = codePointLength(trimmedRationale);
  const nameError = nameLength > NAME_LIMIT ? 'Name must be 80 characters or fewer.' : null;
  const rationaleError = rationaleLength > RATIONALE_LIMIT ? 'Rationale must be 500 characters or fewer.' : null;
  const canSubmit = nameLength >= 1 && nameError === null && rationaleError === null;
  const detail = currentDetail(importedAt);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  async function settle(request: CreateProposalRequest): Promise<void> {
    const result = await onCreate(request);
    if (result.ok) {
      onClose();
      return;
    }
    setAlert(`Could not create the proposal: ${result.message}`);
    pendingRef.current = false;
    setPending(false);
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pendingRef.current) return;
    const nextName = name.trim();
    const nextRationale = rationale.trim();
    if (
      codePointLength(nextName) < 1 ||
      codePointLength(nextName) > NAME_LIMIT ||
      codePointLength(nextRationale) > RATIONALE_LIMIT
    ) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setAlert(null);
    const request: CreateProposalRequest = {
      name: nextName,
      rationale: nextRationale === '' ? null : nextRationale,
      source,
    };
    void settle(request);
  }

  return (
    <div className="wb-start-proposal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="wb-start-proposal-dialog">
        <h2 id={titleId} className="wb-start-proposal-title">
          Start a proposal
        </h2>
        <form className="wb-start-proposal-form" noValidate onSubmit={onSubmit}>
          <fieldset className="wb-start-proposal-sources">
            <legend>Start from</legend>
            <label className={cx('wb-start-proposal-option', source.kind === 'current' ? 'is-checked' : undefined)}>
              <input
                type="radio"
                name={radioName}
                value="current"
                checked={source.kind === 'current'}
                aria-label="Current"
                aria-describedby={currentDetailId}
                onChange={() => {
                  setSource({ kind: 'current' });
                }}
              />
              <span className="wb-start-proposal-option-text">
                <span className="wb-start-proposal-option-name">Current</span>
                <span id={currentDetailId} className="wb-start-proposal-option-detail">
                  {detail}
                </span>
              </span>
            </label>
            {ordered.map((proposal, index) => {
              const label = `Duplicate “${proposal.name}”`;
              const optionDetail = duplicateDetail(proposal.status);
              const optionDetailId = `${idPrefix}-proposal-${String(index)}-detail`;
              const checked = source.kind === 'proposal' && source.proposalId === proposal.id;
              return (
                <label key={proposal.id} className={cx('wb-start-proposal-option', checked ? 'is-checked' : undefined)}>
                  <input
                    type="radio"
                    name={radioName}
                    value={proposal.id}
                    checked={checked}
                    aria-label={label}
                    aria-describedby={optionDetailId}
                    onChange={() => {
                      setSource({ kind: 'proposal', proposalId: proposal.id });
                    }}
                  />
                  <span className="wb-start-proposal-option-text">
                    <span className="wb-start-proposal-option-name">{label}</span>
                    <span id={optionDetailId} className="wb-start-proposal-option-detail">
                      {optionDetail}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="wb-start-proposal-field">
            <label className="wb-start-proposal-label" htmlFor={nameId}>
              Name
            </label>
            <input
              id={nameId}
              ref={nameRef}
              className="wb-start-proposal-input"
              type="text"
              value={name}
              autoComplete="off"
              aria-invalid={nameError !== null}
              aria-describedby={nameError === null ? undefined : nameErrorId}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            {nameError === null ? null : (
              <p id={nameErrorId} className="wb-start-proposal-field-error">
                {nameError}
              </p>
            )}
          </div>
          <div className="wb-start-proposal-field">
            <label className="wb-start-proposal-label" htmlFor={rationaleId}>
              Rationale <span className="wb-start-proposal-optional">(optional)</span>
            </label>
            <textarea
              id={rationaleId}
              className="wb-start-proposal-textarea"
              value={rationale}
              rows={2}
              placeholder="Why are we considering this?"
              autoComplete="off"
              aria-invalid={rationaleError !== null}
              aria-describedby={rationaleError === null ? undefined : rationaleErrorId}
              onChange={(event) => {
                setRationale(event.target.value);
              }}
            />
            {rationaleError === null ? null : (
              <p id={rationaleErrorId} className="wb-start-proposal-field-error">
                {rationaleError}
              </p>
            )}
          </div>
          {alert === null ? null : (
            <p role="alert" className="wb-start-proposal-alert">
              {alert}
            </p>
          )}
          <div className="wb-start-proposal-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !canSubmit}>
              {pending ? 'Creating…' : 'Create proposal'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
