import { useId, useState, type ReactElement } from 'react';
import { summaryAllText, summaryText, type SummaryGroup } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { formatAcceptedDate, sortHistory } from './acceptance.ts';
import './accepted.css';

/*
 * Standalone accepted-proposal view (SPEC §3, artboard 26): the Accepted
 * list, the status selector (reopen to Draft, or accept when eligible), and
 * the frozen callings-and-releases summary as copyable plain text. The text
 * is core's `summaryText` / `summaryAllText` unchanged.
 */

export interface AcceptedViewProps {
  history: { id: string; name: string; acceptedAt: string }[];
  selectedId: string | null;
  proposal: {
    name: string;
    status: 'draft' | 'accepted';
    accepted: { byLogin: string; at: string; summary: SummaryGroup[] } | null;
  } | null;
  blockReasons: string[];
  onSelect: (id: string) => void;
  onSetStatus: (status: 'draft' | 'accepted') => Promise<RequestResult>;
  /** Injected clipboard writer. */
  copy: (text: string) => Promise<void>;
  onExit: () => void;
}

const MIDDLE_DOT = '·';
const COPY_FAILED = "Couldn't copy. Select the text and copy it manually.";

/** What was last copied, and for which proposal state, so stale marks fall away. */
interface CopiedMark {
  readonly scope: string;
  readonly key: string;
}

function CheckIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

function CopyIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function AcceptedView({
  history,
  selectedId,
  proposal,
  blockReasons,
  onSelect,
  onSetStatus,
  copy,
  onExit,
}: AcceptedViewProps): ReactElement {
  const statusId = useId();
  const blockedId = useId();
  const [pending, setPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopiedMark | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const scope = `${selectedId ?? ''}|${proposal?.status ?? ''}`;
  const copiedKey = copied !== null && copied.scope === scope ? copied.key : null;
  const sorted = sortHistory(history);

  async function doCopy(key: string, text: string): Promise<void> {
    setCopyFailed(false);
    try {
      await copy(text);
      setCopied({ scope, key });
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }

  async function changeStatus(next: 'draft' | 'accepted'): Promise<void> {
    setStatusError(null);
    setPending(true);
    try {
      const result = await onSetStatus(next);
      if (!result.ok) {
        setStatusError(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  const accepted = proposal?.status === 'accepted' ? proposal.accepted : null;
  const summary = accepted?.summary ?? [];
  const date = accepted === null ? null : formatAcceptedDate(accepted.at);
  const blocked = proposal !== null && proposal.status === 'draft' && blockReasons.length > 0;
  const announcement = copiedKey === null ? '' : copiedKey === 'all' ? 'Copied all' : `Copied ${copiedKey}`;

  return (
    <div className="wb-accepted">
      <nav className="wb-accepted-nav" aria-label="Accepted proposals">
        <button type="button" className="wb-accepted-back" onClick={onExit}>
          {'← Back to board'}
        </button>
        <h2 className="wb-accepted-nav-title">Accepted proposals</h2>
        {sorted.length === 0 ? (
          <p className="wb-accepted-muted">No accepted proposals yet.</p>
        ) : (
          sorted.map((entry) => {
            const entryDate = formatAcceptedDate(entry.acceptedAt);
            return (
              <button
                key={entry.id}
                type="button"
                className="wb-accepted-entry"
                aria-current={entry.id === selectedId ? 'page' : undefined}
                onClick={() => {
                  onSelect(entry.id);
                }}
              >
                <span className="wb-accepted-entry-name">{entry.name}</span>
                <span className="wb-accepted-entry-date">{entryDate === null ? 'Accepted' : `Accepted ${entryDate}`}</span>
              </button>
            );
          })
        )}
      </nav>

      <div className="wb-accepted-main">
        {proposal === null ? (
          <p className="wb-accepted-muted">Select an accepted proposal.</p>
        ) : (
          <>
            <header className="wb-accepted-header">
              <div className="wb-accepted-title">
                <span className={`wb-accepted-badge wb-accepted-badge-${proposal.status}`}>
                  {proposal.status === 'accepted' ? <CheckIcon /> : null}
                  {proposal.status === 'accepted' ? 'ACCEPTED' : 'DRAFT'}
                </span>
                <h1>{proposal.name}</h1>
                <span className="wb-accepted-sub">
                  {accepted !== null
                    ? `Accepted ${date === null ? '' : `${date} `}by ${accepted.byLogin} ${MIDDLE_DOT} read-only`
                    : `Draft ${MIDDLE_DOT} editable`}
                </span>
              </div>
              <div className="wb-accepted-status">
                <label htmlFor={statusId}>Status</label>
                <select
                  id={statusId}
                  value={proposal.status}
                  disabled={pending}
                  aria-describedby={blocked ? blockedId : undefined}
                  onChange={(event) => {
                    const next = event.target.value === 'draft' ? 'draft' : 'accepted';
                    void changeStatus(next);
                  }}
                >
                  <option value="accepted" disabled={blocked}>
                    Accepted (read-only)
                  </option>
                  <option value="draft">Draft (editable)</option>
                </select>
              </div>
            </header>

            {statusError === null ? null : (
              <p role="alert" className="wb-accepted-error">
                {statusError}
              </p>
            )}

            {blocked ? (
              <section className="wb-accepted-blocked" aria-labelledby={blockedId}>
                <h2 id={blockedId}>Can&apos;t accept yet</h2>
                <ul>
                  {blockReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {accepted === null ? (
              proposal.status === 'draft' ? (
                <p className="wb-accepted-muted">
                  Accepting freezes a callings-and-releases summary for each bishopric member.
                </p>
              ) : null
            ) : (
              <>
                <div className="wb-accepted-body-head">
                  <div>
                    <h2>Callings &amp; releases by bishopric member</h2>
                    <span className="wb-accepted-muted">Grouped by who extends each calling.</span>
                  </div>
                  <button
                    type="button"
                    className="wb-accepted-copy-all"
                    onClick={() => {
                      void doCopy('all', summaryAllText(summary));
                    }}
                  >
                    {copiedKey === 'all' ? 'Copied' : 'Copy all'}
                  </button>
                </div>

                {summary.length === 0 ? <p className="wb-accepted-muted">{summaryAllText(summary)}</p> : null}

                {summary.map((group) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    copied={copiedKey === group.heading}
                    onCopy={() => {
                      void doCopy(group.heading, summaryText(group));
                    }}
                  />
                ))}
              </>
            )}

            {copyFailed ? (
              <p role="alert" className="wb-accepted-error">
                {COPY_FAILED}
              </p>
            ) : null}
            <p role="status" aria-live="polite" className="wb-accepted-sr">
              {announcement}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  group,
  copied,
  onCopy,
}: {
  group: SummaryGroup;
  copied: boolean;
  onCopy: () => void;
}): ReactElement {
  const headingId = useId();
  return (
    <section className="wb-accepted-group" aria-labelledby={headingId}>
      <div className="wb-accepted-group-head">
        <h3 id={headingId}>{group.heading}</h3>
        <button type="button" className="wb-accepted-copy" aria-label={`Copy ${group.heading}`} onClick={onCopy}>
          <CopyIcon />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{summaryText(group)}</pre>
    </section>
  );
}
