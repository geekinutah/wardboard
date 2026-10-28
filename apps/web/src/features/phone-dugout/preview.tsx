import { useMemo, useState, type ReactElement } from 'react';
import {
  addToDugout,
  dugout,
  proposalDiff,
  removedState,
  sequentialIds,
  vacancies,
  type Board,
  type MemberId,
  type OperationContext,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneShell, type PhoneTab } from '../phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../phone-shell/summary.ts';
import { PhoneDugout } from './PhoneDugout.tsx';

function PhoneDugoutPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const jo = Object.values(data.ward.members).find((m) => m.name === 'Jo Testwell');

  const initialBoard = useMemo(() => {
    if (jo === undefined) return data.proposal.board;
    const ctx: OperationContext = { ward: data.ward, ids: sequentialIds('dugout-preview') };
    const res = addToDugout(data.proposal.board, ctx, { memberId: jo.id });
    return res.ok ? res.board : data.proposal.board;
  }, [data, jo]);

  const [board] = useState<Board>(initialBoard);
  const [activeBoardId, setActiveBoardId] = useState<string>(data.proposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('dugout');
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
  ];

  const editable = activeBoardId === data.proposal.id;
  const currentBoard = editable ? board : data.current;
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
      {activeTab === 'dugout' ? (
        <>
          {status !== null && (
            <p
              className="wb-phone-dugout-status"
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
          <PhoneDugout
            board={currentBoard}
            ward={data.ward}
            editable={editable}
            onPlaceMember={(memberId) => {
              const member = data.ward.members[memberId as MemberId];
              setStatus(`Place ${member?.name ?? memberId}`);
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
  title: 'Phone dugout',
  render: (data) => <PhoneDugoutPreview data={data} />,
};

export default preview;
