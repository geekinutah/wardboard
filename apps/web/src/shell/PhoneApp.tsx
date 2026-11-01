import { useEffect, useRef, useState, type ReactElement } from 'react';
import { diffBoards, dugout, vacancies, type Board, type CallingGroupId, type Proposal } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { buildPhoneChangesModel } from '../features/phone-changes/model.ts';
import { PhoneChanges } from '../features/phone-changes/PhoneChanges.tsx';
import { PhoneDugout } from '../features/phone-dugout/PhoneDugout.tsx';
import type { PhoneBoardScreen } from '../features/phone-board/PhoneBoard.tsx';
import { PhoneSearch, type PhoneSearchTarget } from '../features/phone-search/PhoneSearch.tsx';
import { PhoneShell, type PhoneTab } from '../features/phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../features/phone-shell/summary.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncBanner, useBaseline, useMe, useSync, useSyncClient } from '../sync/react.tsx';
import { PhoneBoardEditing } from './PhoneEditing.tsx';
import { StartProposal } from './StartProposal.tsx';
import { useCurrentBoard, useRemovedState } from './board-levels.tsx';
import './phone-app.css';

type BoardList = { current: CurrentInfo | null; proposals: readonly ProposalSummary[] };

type PendingOrg = { readonly boardId: string; readonly boardGroupId: string };

type StatusAlert = { readonly proposalId: string; readonly message: string };

function byTabOrder(a: ProposalSummary, b: ProposalSummary): number {
  if (a.tabOrder !== b.tabOrder) return a.tabOrder - b.tabOrder;
  return a.id.localeCompare(b.id, 'en');
}

/** The core proposal `buildPhoneChangesModel` needs. `createdAt` stays empty until `getProposal` answers. */
function changesProposal(view: ProposalView, baseline: Board, board: Board, createdAt: string): Proposal {
  return {
    id: view.id,
    name: view.name,
    rationale: view.rationale,
    status: view.status,
    accepted: null,
    baseline,
    board,
    tabOrder: 0,
    createdAt,
    updatedAt: '',
  };
}

/** Other boards to read while Search is open, Current first, then proposal tab order. */
function otherBoardIds(listed: BoardList, subscribedId: string): string[] {
  const ids: string[] = [];
  if (listed.current !== null && listed.current.boardId !== subscribedId) ids.push(listed.current.boardId);
  for (const item of [...listed.proposals].sort(byTabOrder)) {
    if (item.boardId !== subscribedId && !ids.includes(item.boardId)) ids.push(item.boardId);
  }
  return ids;
}

function boardsForSearch(active: Board, listed: BoardList | null, fetched: ReadonlyMap<string, Board>): Board[] {
  const rest: Board[] = [];
  if (listed?.current != null && listed.current.boardId !== active.id) {
    const current = fetched.get(listed.current.boardId);
    if (current !== undefined) rest.push(current);
  }
  if (listed !== null) {
    for (const item of [...listed.proposals].sort(byTabOrder)) {
      if (item.boardId === active.id) continue;
      const found = fetched.get(item.boardId);
      if (found !== undefined) rest.push(found);
    }
  }
  return [active, ...rest];
}

/** Walk calling-group parents to a board group. A missing link or a cycle stays put. */
function parentBoardGroupId(source: Board, callingGroup: string): string | null {
  const seen = new Set<string>();
  let current = callingGroup;
  for (;;) {
    if (seen.has(current)) return null;
    seen.add(current);
    if (!Object.hasOwn(source.callingGroups, current)) return null;
    const group = source.callingGroups[current as CallingGroupId];
    if (group === undefined) return null;
    if (group.parent.kind === 'boardGroup') {
      return Object.hasOwn(source.boardGroups, group.parent.id) ? group.parent.id : null;
    }
    current = group.parent.id;
  }
}

export function PhoneApp(): ReactElement {
  const client = useSyncClient();
  const { boards, board, ward, proposal, subscribedBoardId, open, send, fetchBoard } = useSync();
  const me = useMe();
  const baseline = useBaseline();
  const currentBoard = useCurrentBoard();
  const { removed } = useRemovedState(proposal, baseline, board, ward, currentBoard);

  const [activeTab, setActiveTab] = useState<PhoneTab>('board');
  const [startProposalOpen, setStartProposalOpen] = useState(false);
  const [listResetKey, setListResetKey] = useState(0);
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null);
  const [pendingOrg, setPendingOrg] = useState<PendingOrg | null>(null);
  const [fetchedBoards, setFetchedBoards] = useState<ReadonlyMap<string, Board>>(() => new Map());
  const [changeDetail, setChangeDetail] = useState<{ readonly proposalId: string; readonly createdAt: string } | null>(
    null,
  );
  const [statusAlert, setStatusAlert] = useState<StatusAlert | null>(null);
  const openedCurrent = useRef(false);
  const searchVisit = useRef(0);
  const requestedBoardIds = useRef<Set<string>>(new Set());
  const changesVisit = useRef(0);
  const requestedDetailIds = useRef<Set<string>>(new Set());
  const statusBusy = useRef(false);

  useEffect(() => {
    if (openedCurrent.current) return;
    if (boards === null || boards.current === null) return;
    openedCurrent.current = true;
    if (subscribedBoardId === null) open(boards.current.boardId);
  }, [boards, subscribedBoardId, open]);

  // One getBoard per other board during this Search visit. A late reply after
  // leaving Search must not change the Board tab or open a sheet.
  useEffect(() => {
    if (activeTab !== 'search' || board === null || ward === null || boards === null) return;
    const visit = searchVisit.current;
    const subscribedId = subscribedBoardId ?? board.id;
    for (const id of otherBoardIds(boards, subscribedId)) {
      if (requestedBoardIds.current.has(id)) continue;
      requestedBoardIds.current.add(id);
      void fetchBoard(id).then((resolved) => {
        if (searchVisit.current !== visit || resolved === null) return;
        setFetchedBoards((current) => {
          if (current.get(resolved.id) === resolved) return current;
          const next = new Map(current);
          next.set(resolved.id, resolved);
          return next;
        });
      });
    }
  }, [activeTab, board, ward, boards, subscribedBoardId, fetchBoard]);

  useEffect(() => {
    if (activeTab === 'search') return;
    searchVisit.current += 1;
    requestedBoardIds.current = new Set();
  }, [activeTab]);

  // One getProposal per open proposal id during this Changes visit. A late reply
  // after leaving Changes, or a detail for another id, must not change the subtitle.
  useEffect(() => {
    if (activeTab !== 'changes' || proposal === null) return;
    const proposalId = proposal.id;
    if (requestedDetailIds.current.has(proposalId)) return;
    requestedDetailIds.current.add(proposalId);
    const visit = changesVisit.current;
    void client.getProposal(proposalId).then((result) => {
      if (changesVisit.current !== visit || !result.ok || result.proposal.id !== proposalId) return;
      setChangeDetail({ proposalId, createdAt: result.proposal.createdAt });
    });
  }, [activeTab, proposal, client]);

  useEffect(() => {
    if (activeTab === 'changes') return;
    changesVisit.current += 1;
    requestedDetailIds.current = new Set();
    setChangeDetail(null);
  }, [activeTab]);

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

  const editable = proposal !== null && proposal.status === 'draft' && me !== null && baseline !== null;
  const boardName = proposal?.name ?? 'Current';

  function clearTransient(): void {
    setFocusMemberId(null);
    setPendingOrg(null);
  }

  function changeStatus(status: 'accepted' | 'draft'): void {
    if (me === null || proposal === null || statusBusy.current) return;
    const proposalId = proposal.id;
    statusBusy.current = true;
    void client.setProposalStatus(proposalId, status).then((result) => {
      statusBusy.current = false;
      if (!result.ok && result.message !== '') {
        setStatusAlert({ proposalId, message: result.message });
        return;
      }
      setStatusAlert(null);
    });
  }

  function knownBoard(id: string): Board | null {
    if (board !== null && board.id === id) return board;
    return fetchedBoards.get(id) ?? null;
  }

  function openPerson(memberId: string): void {
    if (ward === null || !Object.hasOwn(ward.members, memberId)) return;
    setFocusMemberId(memberId);
  }

  function showOrganization(nextBoardId: string, boardGroupId: string): void {
    const source = knownBoard(nextBoardId);
    if (source === null || !Object.hasOwn(source.boardGroups, boardGroupId)) return;
    setFocusMemberId(null);
    setPendingOrg({ boardId: nextBoardId, boardGroupId });
    setActiveTab('board');
    if (subscribedBoardId !== nextBoardId) open(nextBoardId);
  }

  function selectResult(target: PhoneSearchTarget): void {
    if (target.kind === 'person') {
      openPerson(target.memberId);
      return;
    }
    if (target.kind === 'tag') return;
    if (target.kind === 'calling') {
      showOrganization(target.boardId, target.boardGroupId);
      return;
    }
    const source = knownBoard(target.boardId);
    if (source === null) return;
    if (target.groupKind === 'boardGroup') {
      showOrganization(target.boardId, target.id);
      return;
    }
    const boardGroupId = parentBoardGroupId(source, target.id);
    if (boardGroupId === null) return;
    showOrganization(target.boardId, boardGroupId);
  }

  function addMemberToDugout(memberId: string): void {
    if (!editable) return;
    void send('addToDugout', { memberId });
  }

  const organizationScreen: PhoneBoardScreen | null =
    pendingOrg !== null && board !== null && pendingOrg.boardId === board.id
      ? { kind: 'organization', boardGroupId: pendingOrg.boardGroupId }
      : null;

  const changesAlert =
    statusAlert !== null && proposal !== null && statusAlert.proposalId === proposal.id ? statusAlert.message : null;

  let tabBody: ReactElement;
  if (board === null || ward === null) {
    tabBody = <p className="wb-phone-app-loading">Loading board…</p>;
  } else if (activeTab === 'changes' && proposal !== null && (baseline === null || currentBoard === null)) {
    tabBody = <p className="wb-phone-app-loading">Loading board…</p>;
  } else if (activeTab === 'changes' && proposal !== null && baseline !== null && currentBoard !== null) {
    const createdAt = changeDetail !== null && changeDetail.proposalId === proposal.id ? changeDetail.createdAt : '';
    const reopen = me !== null && proposal.status === 'accepted' ? () => { changeStatus('draft'); } : undefined;
    tabBody = (
      <>
        {changesAlert !== null ? <p role="alert">{changesAlert}</p> : null}
        <PhoneChanges
          model={buildPhoneChangesModel(changesProposal(proposal, baseline, board, createdAt), currentBoard, ward)}
          onAccept={() => {
            changeStatus('accepted');
          }}
          {...(reopen === undefined ? {} : { onReopen: reopen })}
        />
      </>
    );
  } else if (activeTab === 'changes') {
    tabBody = (
      <PhoneChanges
        model={null}
        onAccept={() => undefined}
      />
    );
  } else if (activeTab === 'board') {
    tabBody = (
      <PhoneBoardEditing
        key={`${subscribedBoardId ?? ''}:${String(listResetKey)}:${organizationScreen?.boardGroupId ?? ''}`}
        board={board}
        baseline={baseline}
        ward={ward}
        proposal={proposal}
        me={me}
        boardName={boardName}
        {...(organizationScreen === null ? {} : { initialScreen: organizationScreen })}
      />
    );
  } else if (activeTab === 'search') {
    tabBody = (
      <PhoneSearch
        ward={ward}
        activeBoard={board}
        allBoards={boardsForSearch(board, boards, fetchedBoards)}
        editable={editable}
        onSelectResult={selectResult}
        onAddToDugout={addMemberToDugout}
      />
    );
  } else {
    tabBody = <PhoneDugout board={board} ward={ward} editable={editable} onPlaceMember={openPerson} />;
  }

  const personSheet =
    focusMemberId !== null && board !== null && ward !== null ? (
      <PhoneBoardEditing
        key={`person:${board.id}:${focusMemberId}`}
        sheetOnly
        focusMemberId={focusMemberId}
        onSheetClose={() => {
          setFocusMemberId(null);
        }}
        board={board}
        baseline={baseline}
        ward={ward}
        proposal={proposal}
        me={me}
        boardName={boardName}
      />
    ) : null;

  return (
      <PhoneShell
        boards={entries}
        activeBoardId={subscribedBoardId ?? ''}
        summary={summary}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          clearTransient();
        }}
        dugoutCount={board !== null && ward !== null ? dugout(board, ward).length : 0}
        onSelectBoard={(id) => {
          open(id);
          setListResetKey((key) => key + 1);
          clearTransient();
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
        {tabBody}
        {personSheet}
      </PhoneShell>
  );
}
