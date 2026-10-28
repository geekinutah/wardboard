import type { ReactElement } from 'react';
import type { Board, Proposal, Ward } from '@wardboard/core';
import { Summary } from '../features/summary/Summary.tsx';
import type { ProposalView } from '../sync/protocol.ts';

export interface SummaryModeProps {
  readonly proposal: ProposalView;
  readonly baseline: Board | null;
  readonly board: Board | null;
  readonly ward: Ward | null;
  readonly current: Board | null;
  readonly importedAt: string | null;
  readonly onExit: () => void;
}

export function SummaryMode({
  proposal: view,
  baseline,
  board,
  ward,
  current,
  importedAt,
  onExit,
}: SummaryModeProps): ReactElement {
  if (current === null || baseline === null || board === null || ward === null) {
    return (
      <div className="shell-body">
        <p className="shell-loading">Loading summary…</p>
      </div>
    );
  }

  const proposal: Proposal = {
    id: view.id,
    name: view.name,
    status: view.status,
    rationale: view.rationale,
    accepted: null,
    tabOrder: 0,
    createdAt: '',
    updatedAt: '',
    baseline,
    board,
  };

  return (
    <Summary
      proposal={proposal}
      current={current}
      ward={ward}
      importedAt={importedAt}
      onExit={onExit}
    />
  );
}
