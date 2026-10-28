import type { ReactElement } from 'react';
import { Button } from '../../design/Button.tsx';
import { formatImportDate } from './import-date.ts';
import './proposals.css';

export type CurrentReadOnlyBarProps = {
  readonly importedAt: string;
  readonly onStartProposal: () => void;
};

export function CurrentReadOnlyBar({ importedAt, onStartProposal }: CurrentReadOnlyBarProps): ReactElement {
  const date = formatImportDate(importedAt);

  return (
    <section className="wb-current-bar" aria-label="Current is read-only">
      <div className="wb-current-bar-row">
        <span className="wb-current-chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Current
        </span>
        <p className="wb-current-meta">
          {date === null ? (
            'Read-only · import date unknown'
          ) : (
            <>
              Read-only · imported <strong>{date}</strong>
            </>
          )}
        </p>
        <Button variant="primary" type="button" onClick={onStartProposal}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Start proposal
        </Button>
      </div>
      <p className="wb-current-sentence">{"Current can't be edited. Start a proposal to plan changes."}</p>
    </section>
  );
}
