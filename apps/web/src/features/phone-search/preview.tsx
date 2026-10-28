import { useMemo, useState, type ReactElement } from 'react';
import {
  addToDugout,
  dugout,
  proposalDiff,
  removedState,
  sequentialIds,
  vacancies,
  type AssignmentId,
  type Board,
  type MemberId,
  type OperationContext,
  type TagId,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneShell, type PhoneTab } from '../phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../phone-shell/summary.ts';
import { PhoneSearch, type PhoneSearchTarget } from './PhoneSearch.tsx';

function PhoneSearchPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [board, setBoard] = useState<Board>(data.proposal.board);
  const [activeBoardId, setActiveBoardId] = useState<string>(data.proposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('search');
  const [status, setStatus] = useState<string | null>(null);

  const ctx = useMemo<OperationContext>(
    () => ({ ward: data.ward, ids: sequentialIds('preview-search') }),
    [data.ward],
  );

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
  ];

  const editable = activeBoardId === data.proposal.id;
  const currentBoard = editable ? board : data.current;
  const allBoards = [currentBoard, data.current];

  const dugoutCount = dugout(currentBoard, data.ward).length;
  const summary =
    activeBoardId === data.current.id
      ? headerSummary({
          kind: 'current',
          callings: 0,
          releases: 0,
          vacant: vacancies(data.current).length,
        })
      : headerSummary({
          kind: 'proposal',
          callings: fixtureDiff.callings.length,
          releases: fixtureDiff.releases.length,
          vacant: vacancies(currentBoard).length,
        });

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
      {activeTab === 'search' ? (
        <>
          {status !== null && (
            <p
              className="wb-phone-search-status"
              role="status"
              style={{
                padding: '8px 16px',
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--wb-accent, #1d5c68)',
                background: 'var(--wb-surface, #ffffff)',
                borderBottom: '1px solid var(--wb-line, #d9ddd8)',
              }}
            >
              {status}
            </p>
          )}
          <PhoneSearch
            ward={data.ward}
            activeBoard={currentBoard}
            allBoards={allBoards}
            editable={editable}
            initialQuery="a"
            onSelectResult={(target: PhoneSearchTarget) => {
              if (target.kind === 'person') {
                const member = data.ward.members[target.memberId as MemberId];
                setStatus(`Person ${member?.name ?? target.memberId}`);
              } else if (target.kind === 'calling') {
                const assignment = currentBoard.assignments[target.assignmentId as AssignmentId];
                setStatus(`Calling ${assignment?.title ?? target.assignmentId}`);
              } else if (target.kind === 'tag') {
                const tag = data.ward.tags[target.tagId as TagId];
                setStatus(`Tag ${tag?.name ?? target.tagId}`);
              } else {
                setStatus(`Group ${target.id}`);
              }
            }}
            onAddToDugout={(memberId) => {
              const result = addToDugout(board, ctx, { memberId: memberId as MemberId });
              if (result.ok) {
                setBoard(result.board);
                const member = data.ward.members[memberId as MemberId];
                setStatus(`Added ${member?.name ?? memberId} to dugout`);
              }
            }}
          />
        </>
      ) : (
        <p style={{ padding: 16 }}>Tab content</p>
      )}
    </PhoneShell>
  );
}

const preview: PreviewModule = {
  title: 'Phone search',
  render: (data) => <PhoneSearchPreview data={data} />,
};

export default preview;
