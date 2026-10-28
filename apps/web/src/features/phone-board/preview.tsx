import { useState, type ReactElement } from 'react';
import {
  dugout,
  proposalDiff,
  removedState,
  vacancies,
  type Board,
  type MemberId,
  type PositionId,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneShell, type PhoneTab } from '../phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../phone-shell/summary.ts';
import { PhoneBoard } from './PhoneBoard.tsx';

function callingGroupName(board: Board, id: string): string {
  const found = Object.values(board.callingGroups).find((group) => group.id === id);
  return found === undefined ? id : found.name;
}

function memberName(data: PreviewData, id: string): string {
  const member = data.ward.members[id as MemberId];
  return member === undefined ? id : member.name;
}

function positionTitle(board: Board, id: string): string {
  const position = board.positions[id as PositionId];
  if (position === undefined) {
    return id;
  }
  const assignment = board.assignments[position.assignmentId];
  return assignment === undefined ? id : assignment.title;
}

function PhoneBoardPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [activeBoardId, setActiveBoardId] = useState<string>(data.proposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('board');
  const [status, setStatus] = useState<string | null>(null);

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

  const editable = activeBoardId === data.proposal.id;
  const board = editable ? data.proposal.board : data.current;
  const baseline = editable ? data.proposal.baseline : null;

  let summary: string;
  let dugoutCount: number;
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
  } else {
    summary = headerSummary({
      kind: 'proposal',
      callings: 0,
      releases: 0,
      vacant: vacancies(data.current).length,
    });
    dugoutCount = dugout(data.current, data.ward).length;
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
        setStatus(null);
      }}
      onStartProposal={() => undefined}
      canStartProposal
    >
      {activeTab === 'board' ? (
        <>
          {status !== null ? (
            <p className="wb-phone-board-status" role="status">
              {status}
            </p>
          ) : null}
          <PhoneBoard
            board={board}
            baseline={baseline}
            ward={data.ward}
            editable={editable}
            onAddPosition={(callingGroupId) => {
              setStatus(`Add position requested for ${callingGroupName(board, callingGroupId)}`);
            }}
            onOpenPerson={(memberId) => {
              setStatus(`Person ${memberName(data, memberId)}`);
            }}
            onOpenVacancy={(positionId) => {
              setStatus(`Vacancy ${positionTitle(board, positionId)}`);
            }}
          />
        </>
      ) : (
        <p className="wb-phone-board-placeholder">{tabTitle} tab content</p>
      )}
    </PhoneShell>
  );
}

const preview: PreviewModule = {
  title: 'Phone board',
  render: (data) => <PhoneBoardPreview data={data} />,
};

export default preview;
