import { useEffect, useRef, useState, type ReactElement } from 'react';
import { diffBoards, dugout, vacancies } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { PhoneShell, type PhoneTab } from '../features/phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../features/phone-shell/summary.ts';
import { SyncBanner, useBaseline, useMe, useSync } from '../sync/react.tsx';
import { PhoneBoardEditing } from './PhoneEditing.tsx';
import { StartProposal } from './StartProposal.tsx';
import { useCurrentBoard, useRemovedState } from './board-levels.tsx';
import './phone-app.css';

const TAB_TITLES: Readonly<Record<Exclude<PhoneTab, 'board'>, string>> = {
  search: 'Search',
  dugout: 'Dugout',
  changes: 'Changes',
};

function byTabOrder(a: ProposalSummary, b: ProposalSummary): number {
  if (a.tabOrder !== b.tabOrder) return a.tabOrder - b.tabOrder;
  return a.id.localeCompare(b.id, 'en');
}

function Placeholder({ tab }: { tab: Exclude<PhoneTab, 'board'> }): ReactElement {
  const headingId = `wb-phone-app-${tab}-heading`;
  return (
    <section className="wb-phone-app-placeholder" aria-labelledby={headingId}>
      <h2 id={headingId}>{TAB_TITLES[tab]}</h2>
      <p>This screen isn&apos;t on phones yet.</p>
      <a className="wb-phone-app-placeholder-link" href="/?layout=desktop">
        Use desktop layout
      </a>
    </section>
  );
}

export function PhoneApp(): ReactElement {
  const { boards, board, ward, proposal, subscribedBoardId, open } = useSync();
  const me = useMe();
  const baseline = useBaseline();
  const currentBoard = useCurrentBoard();
  const { removed } = useRemovedState(proposal, baseline, board, ward, currentBoard);

  const [activeTab, setActiveTab] = useState<PhoneTab>('board');
  const [startProposalOpen, setStartProposalOpen] = useState(false);
  const [listResetKey, setListResetKey] = useState(0);
  const openedCurrent = useRef(false);

  useEffect(() => {
    if (openedCurrent.current) return;
    if (boards === null || boards.current === null) return;
    openedCurrent.current = true;
    if (subscribedBoardId === null) open(boards.current.boardId);
  }, [boards, subscribedBoardId, open]);

  const diff = proposal !== null && board !== null && baseline !== null ? diffBoards(baseline, board) : null;
  const removedCount =
    removed === undefined ? 0 : removed.members.length + removed.positions.length;

  const entries: BoardEntry[] = [];
  if (boards?.current !== undefined && boards.current !== null) {
    entries.push({
      id: boards.current.boardId,
      kind: 'current',
      name: 'Current',
      status: 'current',
      importedAt: boards.current.importedAt,
      changeCount: 0,
      removedCount: 0,
    });
  }
  for (const item of boards === null ? [] : [...boards.proposals].sort(byTabOrder)) {
    const known = item.boardId === subscribedBoardId && diff !== null;
    entries.push({
      id: item.boardId,
      kind: 'proposal',
      name: item.name,
      status: item.status,
      importedAt: null,
      changeCount: known ? changeCount(diff) : null,
      removedCount: known ? removedCount : null,
    });
  }

  const summary = headerSummary({
    kind: diff === null ? 'current' : 'proposal',
    callings: diff === null ? 0 : diff.callings.length,
    releases: diff === null ? 0 : diff.releases.length,
    vacant: board === null ? 0 : vacancies(board).length,
  });

  return (
      <PhoneShell
        boards={entries}
        activeBoardId={subscribedBoardId ?? ''}
        summary={summary}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        dugoutCount={board !== null && ward !== null ? dugout(board, ward).length : 0}
        onSelectBoard={(id) => {
          open(id);
          setListResetKey((key) => key + 1);
        }}
        onStartProposal={() => {
          setStartProposalOpen(true);
        }}
        canStartProposal={me !== null}
      >
        <SyncBanner />
        <StartProposal
          isOpen={startProposalOpen}
          onOpen={() => {
            setStartProposalOpen(true);
          }}
          onClose={() => {
            setStartProposalOpen(false);
          }}
        />
        {activeTab === 'board' ? (
          board !== null && ward !== null ? (
            <PhoneBoardEditing
              key={`${subscribedBoardId ?? ''}:${String(listResetKey)}`}
              board={board}
              baseline={baseline}
              ward={ward}
              proposal={proposal}
              me={me}
              boardName={proposal?.name ?? 'Current'}
            />
          ) : (
            <p className="wb-phone-app-loading">Loading board…</p>
          )
        ) : (
          <Placeholder tab={activeTab} />
        )}
      </PhoneShell>
  );
}
