import { useId, useRef, useState, type ReactElement } from 'react';
import { Button } from '../../design/Button.tsx';
import {
  planImportReview,
  resolutionsFor,
  type ImportBlocked,
  type ImportResolution,
  type ImportReviewRow,
  type ImportRowKind,
  type ImportPreview,
} from './plan.ts';
import './import.css';

export type ImportReplaceHandler = (input: {
  expectedVersion: number;
  resolutions: Record<string, ImportResolution>;
}) => Promise<
  | { ok: true; matched: number; created: number; removed: number }
  | { ok: false; code: string; currentVersion?: number }
>;

type ReplaceOutcome = Awaited<ReturnType<ImportReplaceHandler>>;

const DISCARDED = [
  'Phone',
  'Email',
  'Address',
  'Birth date',
  'Age',
  'Record number',
  'Class rosters',
  'Ministering',
] as const;

const NEW_PERSON_DETAIL = 'Not in WardBoard yet. Choose adult or youth.';

const KEPT = 'Names · youth/adult · callings and positions · vacancies · outside-ward callings';

function identityCount(count: number): string {
  return count === 1 ? '1 identity' : `${String(count)} identities`;
}

function blockedMessage(blocked: ImportBlocked): string | null {
  if (blocked === 'duplicate_report') return 'This file was already imported. Replace stays off.';
  if (blocked === 'inconsistent_reports') return 'These reports disagree. Replace stays off.';
  return null;
}

function failureMessage(result: { code: string; currentVersion?: number }): string {
  if (result.code === 'stale' && result.currentVersion !== undefined && Number.isFinite(result.currentVersion)) {
    return `Current changed. It is now version ${String(result.currentVersion)}.`;
  }
  return `Replace did not run (${result.code}).`;
}

function successMessage(result: { matched: number; created: number; removed: number }): string {
  return `Replaced Current. Matched ${String(result.matched)}, created ${String(result.created)}, removed ${String(result.removed)}.`;
}

function replaceName(ready: boolean, unresolved: number): string {
  if (!ready && unresolved > 0) return `Resolve ${identityCount(unresolved)} to continue`;
  return 'Replace Current';
}

function statusClass(status: string): string {
  if (status === 'Duplicate report') return 'duplicate';
  if (status === 'Not collected yet') return 'later';
  return 'validated';
}

function matchPressed(choice: ImportResolution | undefined, memberId: string, kind: ImportRowKind): boolean {
  if (choice === undefined || choice.action !== 'match' || choice.memberId !== memberId) return false;
  if (kind === 'returning') return choice.confirmReturn === true;
  return true;
}

function ChoiceButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Button
      variant={pressed ? 'primary' : 'secondary'}
      className={pressed ? 'wb-import-choice is-pressed' : 'wb-import-choice'}
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
    >
      {pressed ? <span aria-hidden="true">✓ </span> : null}
      {label}
    </Button>
  );
}

export function ImportReview({
  preview,
  expectedVersion,
  onReplace,
}: {
  preview: ImportPreview;
  expectedVersion: number;
  onReplace: ImportReplaceHandler;
}): ReactElement {
  const [choices, setChoices] = useState<Record<string, ImportResolution>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReplaceOutcome | null>(null);
  const pendingRef = useRef(false);
  const review = planImportReview(preview, expectedVersion === 0);
  const idBase = useId();
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const decision = resolutionsFor(preview, choices);
  const blocked = blockedMessage(review.blocked);
  const ready = decision.ready;

  function choose(key: string, resolution: ImportResolution): void {
    setChoices((current) => ({ ...current, [key]: resolution }));
    setResult(null);
  }

  function chooseMatch(row: ImportReviewRow, memberId: string): void {
    if (row.kind === 'returning') {
      choose(row.key, { action: 'match', memberId, confirmReturn: true });
      return;
    }
    choose(row.key, { action: 'match', memberId });
  }

  const unresolvedRows = review.rows.filter((row) => !(row.key in decision.resolutions));
  const firstUnresolved = unresolvedRows[0];

  function goToNext(): void {
    if (firstUnresolved === undefined) return;
    const element = rowRefs.current.get(firstUnresolved.key);
    if (element === undefined) return;
    if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center' });
    element.focus({ preventScroll: true });
  }

  function chooseNew(row: ImportReviewRow): void {
    const current = choices[row.key];
    if (current?.action === 'new') return;
    choose(row.key, { action: 'new' });
  }

  async function runReplace(): Promise<void> {
    if (!ready || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setResult(null);
    try {
      const outcome = await onReplace({ expectedVersion, resolutions: decision.resolutions });
      setResult(outcome);
    } catch {
      setResult({ ok: false, code: 'offline' });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="wb-import">
      <header className="wb-import-header">
        <p className="wb-import-eyebrow">IMPORT · REPLACE CURRENT</p>
        <h1>Review before replacing Current</h1>
        <ol className="wb-import-steps" aria-label="Import steps">
          <li>1 · Sources</li>
          <li aria-current="step">2 · Preview</li>
          <li>3 · Photos</li>
          <li>4 · Confirm</li>
        </ol>
      </header>

      <div className="wb-import-sources">
        {review.sources.map((source) => (
          <article key={source.name} className="wb-import-card" aria-label={`${source.name}, ${source.status}`}>
            <p className="wb-import-source-name">{source.name}</p>
            <p className="wb-import-muted">{source.detail}</p>
            <p className={`wb-import-status wb-import-status-${statusClass(source.status)}`}>{source.status}</p>
          </article>
        ))}
      </div>

      <div className="wb-import-stats">
        {review.stats.map((stat) => (
          <article key={stat.label} className="wb-import-card wb-import-stat" aria-label={`${stat.label} ${String(stat.value)}`}>
            <p className="wb-import-stat-value">{stat.value}</p>
            <p className="wb-import-stat-label">{stat.label}</p>
          </article>
        ))}
      </div>

      <div className="wb-import-split">
        <section className="wb-import-panel wb-import-decisions">
          <h2>Needs your decision · {identityCount(review.rows.length)}</h2>
          {review.rows.length === 0 ? (
            <p className="wb-import-muted">No identities need a decision.</p>
          ) : (
            <p className="wb-import-muted">Names alone aren&apos;t enough to merge. Choose how each row should be matched.</p>
          )}
          <p className="wb-import-count" aria-live="polite">
            {unresolvedRows.length > 0 ? `${String(unresolvedRows.length)} of ${String(review.rows.length)} need a choice` : ''}
          </p>
          {review.rows.map((row, rowIndex) => {
            const choice = choices[row.key];
            const noMatch = row.matchOptions.length === 0;
            const unresolved = !(row.key in decision.resolutions);
            const showCategory = row.needsCategory && (choice?.action === 'new' || noMatch);
            const detail = noMatch && row.kind === 'new' && row.needsCategory ? NEW_PERSON_DETAIL : row.detail;
            const tagId = `${idBase}-tag-${String(rowIndex)}`;
            return (
              <article
                key={row.key}
                className={unresolved ? 'wb-import-row is-unresolved' : 'wb-import-row'}
                aria-label={row.name}
                aria-describedby={unresolved ? tagId : undefined}
                tabIndex={-1}
                ref={(element) => {
                  if (element === null) rowRefs.current.delete(row.key);
                  else rowRefs.current.set(row.key, element);
                }}
              >
                <div className="wb-import-person-copy">
                  <p className="wb-import-person">{row.name}</p>
                  {unresolved ? (
                    <p className="wb-import-tag" id={tagId}>
                      Needs a choice
                    </p>
                  ) : null}
                  <p className="wb-import-muted">{noMatch && !row.needsCategory ? 'Will be added' : detail}</p>
                </div>
                <div className="wb-import-choices">
                  {row.matchOptions.map((option) => (
                    <ChoiceButton
                      key={option.memberId}
                      label={option.label}
                      pressed={matchPressed(choice, option.memberId, row.kind)}
                      onClick={() => {
                        chooseMatch(row, option.memberId);
                      }}
                    />
                  ))}
                  {noMatch ? null : (
                    <ChoiceButton
                      label="Treat as new person"
                      pressed={choice?.action === 'new'}
                      onClick={() => {
                        chooseNew(row);
                      }}
                    />
                  )}
                  {showCategory ? (
                    <>
                      <ChoiceButton
                        label="Adult"
                        pressed={choice?.action === 'new' && choice.category === 'adult'}
                        onClick={() => {
                          choose(row.key, { action: 'new', category: 'adult' });
                        }}
                      />
                      <ChoiceButton
                        label="Youth"
                        pressed={choice?.action === 'new' && choice.category === 'youth'}
                        onClick={() => {
                          choose(row.key, { action: 'new', category: 'youth' });
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>

        <section className="wb-import-panel wb-import-discarded">
          <h2>Discarded before saving</h2>
          <p className="wb-import-muted">Fields outside the allow-list never reach storage, logs or backups.</p>
          <div className="wb-import-dropped-list">
            {DISCARDED.map((label) => (
              <span key={label} className="wb-import-dropped">
                {label}
              </span>
            ))}
          </div>
          <h3 className="wb-import-kept-label">Kept</h3>
          <p className="wb-import-kept">{KEPT}</p>
        </section>
      </div>

      {blocked === null ? null : (
        <p className="wb-import-alert" role="alert">
          {blocked}
        </p>
      )}

      <section className="wb-import-panel wb-import-confirm">
        <div className="wb-import-confirm-copy">
          <p className="wb-import-confirm-title">Replace Current with this preview</p>
          <p className="wb-import-muted">
            Proposals keep their own baselines. Notes and tags carry over only for confirmed matches.
          </p>
        </div>
        {firstUnresolved === undefined ? null : (
          <Button variant="secondary" className="wb-import-next" onClick={goToNext}>
            {`Go to next: ${firstUnresolved.name}`}
          </Button>
        )}
        <Button
          className="wb-import-replace"
          disabled={!ready || pending}
          onClick={() => {
            void runReplace();
          }}
        >
          {replaceName(ready, decision.unresolved)}
        </Button>
      </section>

      {result?.ok === true ? (
        <p className="wb-import-success" role="status">
          {successMessage(result)}
        </p>
      ) : null}
      {result?.ok === false ? (
        <p className="wb-import-alert" role="alert">
          {failureMessage(result)}
        </p>
      ) : null}
    </div>
  );
}
