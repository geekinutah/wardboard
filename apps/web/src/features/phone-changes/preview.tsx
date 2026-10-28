import { useState, type ReactElement } from 'react';
import {
  dugout,
  proposalDiff,
  removedState,
  vacancies,
  type Board,
  type Proposal,
  type ProposalId,
  type Ward,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneShell, type PhoneTab } from '../phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../phone-shell/summary.ts';
import { buildPhoneChangesModel } from './model.ts';
import { PhoneChanges } from './PhoneChanges.tsx';

function buildPreviewWardAndCurrent(data: PreviewData): {
  readonly wardWithRemoved: Ward;
  readonly currentWithRemoved: Board;
} {
  // 1. One member placed on proposal.board (Flo Madeup, Music Coordinator) has removedDate set
  const flo = Object.values(data.ward.members).find((m) => m.name === 'Flo Madeup');
  const wardWithRemoved: Ward =
    flo !== undefined
      ? {
          ...data.ward,
          members: {
            ...data.ward.members,
            [flo.id]: {
              ...flo,
              removedDate: '2026-10-24',
            },
          },
        }
      : data.ward;

  // 2. One occupied position on proposal.baseline (Livestream Coordinator held by Liv Example) removed from current
  const liveSlot = Object.values(data.current.positions).find((p) => {
    const assignment = data.current.assignments[p.assignmentId];
    return assignment?.title === 'Livestream Coordinator';
  });

  let currentWithRemoved: Board = data.current;
  if (liveSlot !== undefined) {
    const remainingPositions = Object.fromEntries(
      Object.entries(data.current.positions).filter(([id]) => id !== liveSlot.id),
    );
    currentWithRemoved = {
      ...data.current,
      positions: remainingPositions,
    };
  }

  return { wardWithRemoved, currentWithRemoved };
}

function PhoneChangesPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const { wardWithRemoved, currentWithRemoved } = buildPreviewWardAndCurrent(data);

  const [fixtureProposal, setFixtureProposal] = useState<Proposal>(data.proposal);
  const [cleanProposal, setCleanProposal] = useState<Proposal>(() => ({
    ...data.proposal,
    id: 'prop-clean' as ProposalId,
    name: 'Clean proposal',
  }));

  const [activeBoardId, setActiveBoardId] = useState<string>(fixtureProposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('changes');

  // Compute entry info for boards list
  const fixtureRemoved = removedState(fixtureProposal, currentWithRemoved, wardWithRemoved);
  const fixtureRemovedCount = fixtureRemoved.members.length + fixtureRemoved.positions.length;
  const fixtureDiff = proposalDiff(fixtureProposal);

  const cleanDiff = proposalDiff(cleanProposal);

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
      id: fixtureProposal.id,
      kind: 'proposal',
      name: fixtureProposal.name,
      status: fixtureProposal.status,
      importedAt: null,
      changeCount: changeCount(fixtureDiff),
      removedCount: fixtureRemovedCount,
    },
    {
      id: cleanProposal.id,
      kind: 'proposal',
      name: cleanProposal.name,
      status: cleanProposal.status,
      importedAt: null,
      changeCount: changeCount(cleanDiff),
      removedCount: 0,
    },
  ];

  let summary: string;
  let dugoutCount: number;
  let model: ReturnType<typeof buildPhoneChangesModel> | null;
  let onAccept: () => void = () => undefined;
  let onReopen: (() => void) | undefined;

  if (activeBoardId === data.current.id) {
    summary = headerSummary({
      kind: 'current',
      callings: 0,
      releases: 0,
      vacant: vacancies(data.current).length,
    });
    dugoutCount = dugout(data.current, data.ward).length;
    model = null;
  } else if (activeBoardId === fixtureProposal.id) {
    summary = headerSummary({
      kind: 'proposal',
      callings: fixtureDiff.callings.length,
      releases: fixtureDiff.releases.length,
      vacant: vacancies(fixtureProposal.board).length,
    });
    dugoutCount = dugout(fixtureProposal.board, wardWithRemoved).length;
    model = buildPhoneChangesModel(fixtureProposal, currentWithRemoved, wardWithRemoved);
    onAccept = () => {
      setFixtureProposal((p) => ({ ...p, status: 'accepted' }));
    };
    onReopen = () => {
      setFixtureProposal((p) => ({ ...p, status: 'draft' }));
    };
  } else {
    // cleanProposal
    summary = headerSummary({
      kind: 'proposal',
      callings: cleanDiff.callings.length,
      releases: cleanDiff.releases.length,
      vacant: vacancies(cleanProposal.board).length,
    });
    dugoutCount = dugout(cleanProposal.board, data.ward).length;
    model = buildPhoneChangesModel(cleanProposal, data.current, data.ward);
    onAccept = () => {
      setCleanProposal((p) => ({ ...p, status: 'accepted' }));
    };
    onReopen = () => {
      setCleanProposal((p) => ({ ...p, status: 'draft' }));
    };
  }

  const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);

  return (
    <PhoneShell
      boards={boards}
      activeBoardId={activeBoardId}
      summary={summary}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dugoutCount={dugoutCount}
      onSelectBoard={(id) => {
        setActiveBoardId(id);
      }}
      onStartProposal={() => undefined}
      canStartProposal
    >
      {activeTab === 'changes' ? (
        <PhoneChanges
          model={model}
          onAccept={onAccept}
          {...(onReopen !== undefined ? { onReopen } : {})}
        />
      ) : (
        <p style={{ padding: 16, margin: 0, color: 'var(--wb-muted)' }}>
          {tabTitle} tab content
        </p>
      )}
    </PhoneShell>
  );
}

const preview: PreviewModule = {
  title: 'Phone changes',
  render: (data) => <PhoneChangesPreview data={data} />,
};

export default preview;
