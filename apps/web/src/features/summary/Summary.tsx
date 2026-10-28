import { useMemo, type ReactElement } from 'react';
import type { Board, Proposal, Ward } from '@wardboard/core';
import { summaryCsv, summaryFilename } from './csv.ts';
import { summaryRows, type Divergence } from './rows.ts';
import './summary.css';

/*
 * Standalone proposal summary page (SPEC §3, §8, artboard 7): net changes
 * since the saved baseline, remaining vacancies, what Current changed since
 * the baseline, the rationale, and a client-side CSV download.
 */

export interface SummaryProps {
  proposal: Proposal;
  /** The ward's Current board (last import). */
  current: Board;
  ward: Ward;
  /** Current's last-import date (server-side data); null when unknown. */
  importedAt: string | null;
  onExit: () => void;
}

const MINUS = '\u2212';

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatShortDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return shortDate.format(date);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Downloads the CSV as a Blob behind a temporary `<a download>`. */
function downloadCsv(csvText: string, filename: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function Summary({ proposal, current, ward, importedAt, onExit }: SummaryProps): ReactElement {
  const rows = useMemo(() => summaryRows(proposal, current, ward), [proposal, current, ward]);
  const csvText = useMemo(() => summaryCsv(proposal, current, ward), [proposal, current, ward]);
  const filename = summaryFilename(proposal.name);

  const baselineDate = formatShortDate(proposal.createdAt);
  const subtitle =
    baselineDate === null ? 'net changes only' : `Compared with baseline captured ${baselineDate} · net changes only`;

  const importDate = formatShortDate(importedAt);
  const divergenceNote =
    importDate === null ? 'this proposal is unchanged' : `${importDate} · this proposal is unchanged`;

  const hasRationale = proposal.rationale !== null && proposal.rationale.trim() !== '';
  const vacancyTotal = rows.vacancySections.reduce((sum, section) => sum + section.count, 0);

  return (
    <div className="wb-summary">
      <button type="button" className="wb-summary-back" onClick={onExit}>
        {'\u2190 Back to board'}
      </button>

      <header className="wb-summary-header">
        <div className="wb-summary-heading">
          <span className="wb-summary-eyebrow">PROPOSAL SUMMARY</span>
          <h1 className="wb-summary-title">{proposal.name}</h1>
          <span className="wb-summary-subtitle">{subtitle}</span>
        </div>
        <button
          type="button"
          className="wb-summary-download"
          onClick={() => {
            downloadCsv(csvText, filename);
          }}
        >
          Download CSV
        </button>
      </header>

      {rows.divergence.total > 0 ? (
        <section className="wb-summary-divergence" aria-labelledby="wb-summary-divergence-title">
          <div className="wb-summary-divergence-bar">
            <h2 id="wb-summary-divergence-title" className="wb-summary-divergence-heading">
              Current changed since this baseline ·{' '}
              {plural(rows.divergence.total, 'difference', 'differences')}
            </h2>
            <span className="wb-summary-divergence-note">{divergenceNote}</span>
          </div>
          <DivergenceGroups divergence={rows.divergence} />
        </section>
      ) : null}

      {hasRationale ? (
        <section className="wb-summary-rationale">
          <h2 className="wb-summary-rationale-label">Rationale</h2>
          <p className="wb-summary-rationale-text">{proposal.rationale}</p>
        </section>
      ) : null}

      <div className="wb-summary-grid">
        <section className="wb-summary-card" aria-labelledby="wb-summary-card-callings">
          <h2 id="wb-summary-card-callings" className="wb-summary-card-title wb-summary-card-callings">
            {`+ Suggested callings · ${String(rows.callings.length)}`}
          </h2>
          {rows.callings.length === 0 ? (
            <div className="wb-summary-none">None</div>
          ) : (
            rows.callings.map((row, index) => (
              <div className="wb-summary-row" key={index}>
                <span className="wb-summary-row-name">{row.name ?? ''}</span>
                <span className="wb-summary-row-what">{`${row.org} · ${row.title}`}</span>
              </div>
            ))
          )}
        </section>

        <section className="wb-summary-card" aria-labelledby="wb-summary-card-releases">
          <h2 id="wb-summary-card-releases" className="wb-summary-card-title wb-summary-card-releases">
            {`${MINUS} Suggested releases · ${String(rows.releases.length)}`}
          </h2>
          {rows.releases.length === 0 ? (
            <div className="wb-summary-none">None</div>
          ) : (
            rows.releases.map((row, index) => (
              <div className="wb-summary-row" key={index}>
                <span className="wb-summary-row-name">{row.name ?? ''}</span>
                <span className="wb-summary-row-what">{`${row.org} · ${row.title}`}</span>
              </div>
            ))
          )}
        </section>

        <section className="wb-summary-card" aria-labelledby="wb-summary-card-changes">
          <h2 id="wb-summary-card-changes" className="wb-summary-card-title wb-summary-card-changes">
            {`Position changes · ${String(rows.added.length + rows.trimmed.length)}`}
          </h2>
          {rows.added.length + rows.trimmed.length === 0 ? (
            <div className="wb-summary-none">None</div>
          ) : (
            <>
              {rows.added.map((row, index) => (
                <div className="wb-summary-row" key={`added-${String(index)}`}>
                  <span className="wb-summary-row-name">Added</span>
                  <span className="wb-summary-row-what">{`${row.org} · ${row.title}`}</span>
                </div>
              ))}
              {rows.trimmed.map((row, index) => (
                <div className="wb-summary-row" key={`trimmed-${String(index)}`}>
                  <span className="wb-summary-row-name">Trimmed</span>
                  <span className="wb-summary-row-what">{`${row.org} · ${row.title}`}</span>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="wb-summary-card" aria-labelledby="wb-summary-card-vacancies">
          <h2 id="wb-summary-card-vacancies" className="wb-summary-card-title wb-summary-card-vacancies">
            {`Remaining vacancies · ${String(vacancyTotal)}`}
          </h2>
          {rows.vacancySections.length === 0 ? (
            <div className="wb-summary-none">None</div>
          ) : (
            rows.vacancySections.map((section, index) => (
              <div className="wb-summary-row" key={index}>
                <span className="wb-summary-row-name">{section.org}</span>
                <span className="wb-summary-row-what">
                  {section.titles.length > 0
                    ? section.titles.join(', ')
                    : `${String(section.count)} positions across ${String(section.groups)} groups`}
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      <p className="wb-summary-footer">
        Planning reference only. Callings are extended, sustained, set apart, released and recorded in official
        tools. Exported files carry the same confidentiality as the app.
      </p>
    </div>
  );
}

function DivergenceGroups({ divergence }: { divergence: Divergence }): ReactElement {
  return (
    <>
      {divergence.added.length > 0 ? (
        <details open className="wb-summary-divergence-group">
          <summary className="wb-summary-divergence-summary">
            <span className="wb-summary-sign wb-summary-sign-add" aria-hidden="true">
              +
            </span>
            <span className="wb-summary-divergence-headline">Positions added to Current</span>
            <span className="wb-summary-divergence-count">{plural(divergence.added.length, 'position', 'positions')}</span>
          </summary>
          <div className="wb-summary-lines">
            {divergence.added.map((line, index) => (
              <div className="wb-summary-line wb-summary-line-add" key={index}>
                <span className="wb-summary-line-main">
                  + {`${line.org} · ${line.title}`}
                </span>
                <span className="wb-summary-line-note">{line.note}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {divergence.removed.length > 0 ? (
        <details open className="wb-summary-divergence-group">
          <summary className="wb-summary-divergence-summary">
            <span className="wb-summary-sign wb-summary-sign-remove" aria-hidden="true">
              {MINUS}
            </span>
            <span className="wb-summary-divergence-headline">Positions removed from Current</span>
            <span className="wb-summary-divergence-count">
              {plural(divergence.removed.length, 'position', 'positions')}
            </span>
          </summary>
          <div className="wb-summary-lines">
            {divergence.removed.map((line, index) => (
              <div className="wb-summary-line wb-summary-line-remove" key={index}>
                <span className="wb-summary-line-main">
                  {MINUS} {`${line.org} · ${line.title}`}
                </span>
                <span className="wb-summary-line-note">{line.note}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {divergence.members.length > 0 ? (
        <details open className="wb-summary-divergence-group">
          <summary className="wb-summary-divergence-summary">
            <span className="wb-summary-sign wb-summary-sign-remove" aria-hidden="true">
              {MINUS}
            </span>
            <span className="wb-summary-divergence-headline">Ward member removed</span>
            <span className="wb-summary-divergence-count">{plural(divergence.members.length, 'person', 'people')}</span>
          </summary>
          <div className="wb-summary-lines">
            {divergence.members.flatMap((member) =>
              member.positions.map((position, index) => (
                <div
                  className="wb-summary-line wb-summary-line-remove"
                  key={`${member.name}-${String(index)}`}
                >
                  <span className="wb-summary-line-main">
                    {MINUS} {member.name}
                  </span>
                  <span className="wb-summary-line-note">
                    {`Proposed here as ${position.org} · ${position.title}`}
                  </span>
                </div>
              )),
            )}
          </div>
        </details>
      ) : null}
    </>
  );
}

export default Summary;
