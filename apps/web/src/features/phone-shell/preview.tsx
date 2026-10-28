import { useState, type ReactElement } from 'react';
import {
  dugout,
  proposalDiff,
  removedState,
  vacancies,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneShell, type PhoneTab } from './PhoneShell.tsx';
import {
  changeCount,
  headerSummary,
  type BoardEntry,
} from './summary.ts';

function PhoneShellPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [activeBoardId, setActiveBoardId] = useState<string>(data.proposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('board');
  const [startProposalRequested, setStartProposalRequested] = useState(false);

  const fixtureRemoved = removedState(data.proposal, data.current, data.ward);
  const fixtureRemovedCount = fixtureRemoved.members.length + fixtureRemoved.positions.length;
  const fixtureDiff = proposalDiff(data.proposal);
  const fixtureChangeCount = changeCount(fixtureDiff);

  const boards: readonly BoardEntry[] = [
    {
      id: data.current.id,
      kind: 'current',
      name: 'Current',
      status: 'current',
      importedAt: '2026-10-24T12:00:00Z',
      changeCount: 0,
      removedCount: 0,
    },
    {
      id: data.proposal.id,
      kind: 'proposal',
      name: data.proposal.name,
      status: data.proposal.status,
      importedAt: null,
      changeCount: fixtureChangeCount,
      removedCount: fixtureRemovedCount,
    },
    {
      id: 'prop-youth',
      kind: 'proposal',
      name: 'Youth focus',
      status: 'accepted',
      importedAt: null,
      changeCount: 0,
      removedCount: 0,
    },
  ];

  let summary = '';
  let dugoutCount = 0;

  if (activeBoardId === data.current.id) {
    summary = headerSummary({
      kind: 'current',
      callings: 0,
      releases: 0,
      vacant: vacancies(data.current).length,
    });
    dugoutCount = dugout(data.current, data.ward).length;
  } else if (activeBoardId === data.proposal.id) {
    summary = headerSummary({
      kind: 'proposal',
      callings: fixtureDiff.callings.length,
      releases: fixtureDiff.releases.length,
      vacant: vacancies(data.proposal.board).length,
    });
    dugoutCount = dugout(data.proposal.board, data.ward).length;
  } else if (activeBoardId === 'prop-youth') {
    summary = headerSummary({
      kind: 'proposal',
      callings: 0,
      releases: 0,
      vacant: vacancies(data.current).length,
    });
    dugoutCount = dugout(data.current, data.ward).length;
  }

  const activeBoardEntry = boards.find((b) => b.id === activeBoardId);
  const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);

  return (
    <PhoneShell
      boards={boards}
      activeBoardId={activeBoardId}
      summary={summary}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dugoutCount={dugoutCount}
      onSelectBoard={setActiveBoardId}
      onStartProposal={() => {
        setStartProposalRequested(true);
      }}
      canStartProposal={true}
    >
      <div style={{ padding: '16px' }}>
        <p>{tabTitle} tab content</p>
        <p>Active board: {activeBoardEntry?.name ?? 'Unknown'}</p>
        {startProposalRequested && <p>Start proposal requested</p>}
      </div>
    </PhoneShell>
  );
}

const preview: PreviewModule = {
  title: 'Phone shell',
  render: (data) => <PhoneShellPreview data={data} />,
};

export default preview;
