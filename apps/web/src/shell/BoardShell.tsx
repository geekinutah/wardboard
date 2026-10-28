import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  diffBoards,
  vacancies,
  type AddAssignmentRequest,
  type AddCallingGroupRequest,
  type Board,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { Canvas, useCamera, type SelectTarget } from '../features/canvas/Canvas.tsx';
import { cameraReducer, type Camera, type ZoomTarget } from '../features/canvas/camera.ts';
import { Button } from '../design/Button.tsx';
import { RemovedSummary } from '../features/removed/RemovedSummary.tsx';
import { checkHealth, type HealthClient, type HealthState } from '../health.ts';
import type { Me, ProposalView } from '../sync/protocol.ts';
import { ConnectionIndicator, SyncBanner, useBaseline, useMe, useSync } from '../sync/react.tsx';
import { EditingLayer, ShellSearch } from './EditingLayer.tsx';
import { SummaryMode } from './SummaryMode.tsx';
import { StartProposal, StartProposalTabButton } from './StartProposal.tsx';
import { renderBoardLevel, useCurrentBoard, useRemovedState } from './board-levels.tsx';
import { SettingsLink } from './SettingsRoute.tsx';
import { PersonPanel } from './PersonPanel.tsx';

const STATUS_TEXT: Readonly<Record<HealthState, string>> = {
  pending: 'Checking server…',
  ok: 'Server: ok',
  unreachable: 'Server unreachable',
};

const TAB_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const IMPORTED_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatUtc(formatter: Intl.DateTimeFormat, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatter.format(date);
}

function byTabOrder(a: ProposalSummary, b: ProposalSummary): number {
  if (a.tabOrder !== b.tabOrder) return a.tabOrder - b.tabOrder;
  return a.id.localeCompare(b.id, 'en');
}

function roleLabel(role: Me['role']): string {
  return role === 'admin' ? 'Admin' : 'Editor';
}

/** Walk the camera up until the open org and group still exist on this board. */
function safeCamera(board: Board, camera: Camera): Camera {
  let next = camera;
  for (let step = 0; step < 2; step += 1) {
    if (next.level === 3) {
      const groupId = next.groupId;
      if (groupId !== null && Object.hasOwn(board.callingGroups, groupId)) return next;
      next = cameraReducer(next, { type: 'up' });
      continue;
    }
    if (next.level === 2) {
      const orgId = next.orgId;
      if (orgId !== null && Object.hasOwn(board.boardGroups, orgId)) return next;
      next = cameraReducer(next, { type: 'up' });
      continue;
    }
    return next;
  }
  return next;
}

function BrandMark(): ReactElement {
  return (
    <svg className="shell-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
      <rect x="16" y="2" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      <rect x="2" y="16" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="16" y="16" width="10" height="10" rx="2" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function BoardShell({ healthClient }: { healthClient: HealthClient }): ReactElement {
  const currentBoard = useCurrentBoard();
  const me = useMe();
  const baseline = useBaseline();
  const { boards, board, ward, proposal, subscribedBoardId, open, send } = useSync();

  const [health, setHealth] = useState<HealthState>('pending');
  const [camera, dispatch] = useCamera();
  const [selection, setSelection] = useState<ZoomTarget | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [notesMemberId, setNotesMemberId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [startProposalOpen, setStartProposalOpen] = useState(false);
  const openedCurrent = useRef(false);
  const fallbackKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void checkHealth(healthClient).then((result) => {
      if (active) setHealth(result);
    });
    return () => {
      active = false;
    };
  }, [healthClient]);

  useEffect(() => {
    if (openedCurrent.current) return;
    if (boards === null || boards.current === null) return;
    openedCurrent.current = true;
    if (subscribedBoardId === null) open(boards.current.boardId);
  }, [boards, subscribedBoardId, open]);

  const shown = board === null ? camera : safeCamera(board, camera);

  useLayoutEffect(() => {
    if (board === null) return;
    if (shown.level === camera.level) return;
    // One step per commit. StrictMode runs this effect twice; clearing the
    // key in cleanup would drop a second level.
    const key = `${board.id}:${String(board.version)}:${String(camera.level)}:${camera.orgId ?? ''}:${camera.groupId ?? ''}`;
    if (fallbackKey.current === key) return;
    fallbackKey.current = key;
    dispatch({ type: 'up' });
  }, [board, camera, shown.level, dispatch]);

  function selectBoard(nextBoardId: string): void {
    if (nextBoardId === subscribedBoardId) return;
    setSummaryOpen(false);
    setSelection(null);
    setSelectedMemberId(null);
    setNotesMemberId(null);
    dispatch({ type: 'fit' });
    open(nextBoardId);
  }

  function onSelect(target: SelectTarget): void {
    if (target.kind === 'member') {
      setSelectedMemberId(target.id);
      return;
    }
    setSelectedMemberId(null);
    setSelection(target);
  }

  function onAddPosition(request: AddAssignmentRequest): void {
    void send('addAssignment', request);
  }

  function onAddGroup(request: AddCallingGroupRequest): void {
    void send('addCallingGroup', request);
  }

  const proposals = boards === null ? [] : [...boards.proposals].sort(byTabOrder);
  const readOnly = proposal === null || proposal.status === 'accepted';
  const tabBoardIds = boards === null ? [] : [boards.current?.boardId ?? '', ...proposals.map((item) => item.boardId)];
  const ready = board !== null && ward !== null;

  const { removed, summaryRows } = useRemovedState(proposal, baseline, board, ward, currentBoard);

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <BrandMark />
          <span>WardBoard</span>
        </div>
        <div className="shell-tabs" role="tablist" aria-label="Boards">
          {boards?.current === undefined || boards.current === null ? null : (
            <TabButton
              selected={subscribedBoardId === boards.current.boardId}
              onSelect={() => {
                selectBoard(boards.current === null ? '' : boards.current.boardId);
              }}
            >
              {'Current '}
              <span className="shell-tab-meta">{`imported ${formatUtc(TAB_DATE, boards.current.importedAt)}`}</span>
            </TabButton>
          )}
          {proposals.map((item) => (
            <TabButton
              key={item.id}
              selected={subscribedBoardId === item.boardId}
              onSelect={() => {
                selectBoard(item.boardId);
              }}
            >
              {item.status === 'accepted' ? (
                <>
                  {`${item.name} `}
                  <span className="shell-tab-meta">Accepted</span>
                </>
              ) : (
                item.name
              )}
            </TabButton>
          ))}
          <StartProposalTabButton
            onClick={() => {
              setSummaryOpen(false);
              setStartProposalOpen(true);
            }}
          />
        </div>
        <ShellSearch
          board={board}
          ward={ward}
          tabBoardIds={tabBoardIds}
          readOnly={readOnly}
          onSelectBoard={selectBoard}
          onCameraChange={dispatch}
        />
        {me === null ? null : (
          <p className="shell-account">
            <span className="shell-account-name">{me.displayName}</span>
            <span className="shell-account-role">{roleLabel(me.role)}</span>
          </p>
        )}
        {me === null ? null : <SettingsLink />}
        <ConnectionIndicator />
      </header>
      <main className="shell-main">
        {summaryOpen && proposal !== null ? (
          <>
            <StartProposal
              isOpen={startProposalOpen}
              onOpen={() => {
                setStartProposalOpen(true);
              }}
              onClose={() => {
                setStartProposalOpen(false);
              }}
            />
            <SummaryMode
              proposal={proposal}
              baseline={baseline}
              board={board}
              ward={ward}
              current={currentBoard}
              importedAt={boards?.current?.importedAt ?? null}
              onExit={() => {
                setSummaryOpen(false);
              }}
            />
          </>
        ) : (
          <>
            {ready ? (
              <section className="shell-status-strip" aria-label="Board status">
                <StatusBadge proposal={proposal} />
                <p className="shell-date">
                  {proposal === null
                    ? `Imported ${formatUtc(IMPORTED_DATE, boards?.current?.importedAt ?? '')}`
                    : 'Compared with its baseline'}
                </p>
                <Counts board={board} proposal={proposal} baseline={baseline} />
                {proposal !== null ? (
                  <Button
                    variant="secondary"
                    className="shell-summary-button"
                    onClick={() => {
                      setSummaryOpen(true);
                    }}
                  >
                    Summary
                  </Button>
                ) : null}
              </section>
            ) : null}
            <StartProposal
              isOpen={startProposalOpen}
              onOpen={() => {
                setStartProposalOpen(true);
              }}
              onClose={() => {
                setStartProposalOpen(false);
              }}
            />
            <div className="shell-body">
              <SyncBanner />
              <p className="shell-status" role="status" data-state={health}>
                {STATUS_TEXT[health]}
              </p>
              {proposal !== null && summaryRows !== null ? <RemovedSummary rows={summaryRows} /> : null}
              {ready ? (
                <>
                  <EditingLayer
                    board={board}
                    ward={ward}
                    proposal={proposal}
                    baseline={baseline}
                    me={me}
                    readOnly={readOnly}
                    onCameraChange={dispatch}
                  >
                    <div
                      className="shell-canvas"
                      onClick={(event) => {
                        const target = event.target;
                        if (!(target instanceof Element)) return;
                        if (target.closest('button, a, input, textarea, select')) return;
                        if (target.closest('[data-member-id]')) return;
                        if (target.closest('[data-zoom-target]')) return;
                        setSelectedMemberId(null);
                      }}
                    >
                      <Canvas
                        camera={shown}
                        onCameraChange={dispatch}
                        onSelect={onSelect}
                        onOpenNotes={(id) => {
                          setNotesMemberId(id);
                        }}
                        selection={selection}
                        renderLevel={(levelCamera) =>
                          renderBoardLevel(levelCamera, {
                            board,
                            ward,
                            baseline,
                            selection,
                            readOnly,
                            removed,
                            onAddPosition,
                            onAddGroup,
                            onSetOversight: (r) => void send('setOversight', r),
                            onCameraChange: dispatch,
                          })
                        }
                      />
                    </div>
                  </EditingLayer>
                  <PersonPanel
                    board={board}
                    ward={ward}
                    readOnly={readOnly}
                    selectedMemberId={selectedMemberId}
                    onClearSelection={() => {
                      setSelectedMemberId(null);
                    }}
                    notesMemberId={notesMemberId}
                    onOpenNotes={(id) => {
                      setNotesMemberId(id);
                    }}
                    onCloseNotes={() => {
                      setNotesMemberId(null);
                    }}
                    onSelectMember={(id) => {
                      setSelectedMemberId(id);
                    }}
                  />
                </>
              ) : (
                <p className="shell-loading">Loading board…</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TabButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button type="button" role="tab" className="shell-tab" aria-selected={selected} onClick={onSelect}>
      {children}
    </button>
  );
}

function StatusBadge({ proposal }: { proposal: ProposalView | null }): ReactElement {
  if (proposal === null) return <span className="shell-badge shell-badge-current">CURRENT</span>;
  if (proposal.status === 'accepted') return <span className="shell-badge shell-badge-accepted">ACCEPTED</span>;
  return <span className="shell-badge shell-badge-proposed">PROPOSED</span>;
}

function Counts({
  board,
  proposal,
  baseline,
}: {
  board: Board;
  proposal: ProposalView | null;
  baseline: Board | null;
}): ReactElement {
  const vacant = vacancies(board).length;
  const diff = proposal !== null && baseline !== null ? diffBoards(baseline, board) : null;
  return (
    <div className="shell-counts">
      {diff === null ? null : (
        <>
          <span className="shell-count shell-count-callings">{`+ ${String(diff.callings.length)} suggested callings`}</span>
          <span className="shell-count shell-count-releases">{`\u2212 ${String(diff.releases.length)} suggested releases`}</span>
        </>
      )}
      <span className="shell-count shell-count-vacant">{`${String(vacant)} vacant positions`}</span>
    </div>
  );
}
