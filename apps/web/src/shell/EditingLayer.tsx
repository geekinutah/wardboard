import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  callingGroupId,
  callingsOf,
  type AssignmentId,
  type Board,
  type BoardId,
  type CallingGroupId,
  type MemberId,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import type { CameraAction, ZoomTarget } from '../features/canvas/camera.ts';
import { DndSurface } from '../features/dnd/DndSurface.tsx';
import type { DropOp } from '../features/dnd/types.ts';
import { DugoutPanel } from '../features/dugout/DugoutPanel.tsx';
import { SearchBox, type SearchHighlight, type SearchTarget } from '../features/search/SearchBox.tsx';
import { Button } from '../design/Button.tsx';
import type { OpOutcome } from '../sync/client.ts';
import type { Me, ProposalView } from '../sync/protocol.ts';
import { useSync } from '../sync/react.tsx';
import './editing.css';

/** The element search focuses when a person has no calling. */
const DUGOUT_REGION_ID = 'wb-editing-dugout';

const ZOOM_TARGET_PATTERN = /^(org|group):(.+)$/u;

function parseZoomTarget(value: string): ZoomTarget | null {
  const match = ZOOM_TARGET_PATTERN.exec(value);
  const kind = match?.[1];
  const id = match?.[2];
  if (id === undefined || id.length === 0) return null;
  if (kind === 'org') return { kind: 'org', id };
  if (kind === 'group') return { kind: 'group', id };
  return null;
}

/** The core proposal DndSurface needs, or null on Current or before the baseline loads. */
function coreProposal(view: ProposalView | null, baseline: Board | null, board: Board): Proposal | null {
  if (view === null || baseline === null || board.kind !== 'proposal') return null;
  return {
    id: view.id,
    name: view.name,
    rationale: view.rationale,
    status: view.status,
    // Only Draft proposals are edited here; acceptance details never matter to a drop.
    accepted: null,
    baseline,
    board,
    tabOrder: 0,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * B-031. The position the server gave `member` in `assignment`: one the member
 * holds on the committed board, did not hold before the drop, and has no approval.
 */
export function committedListPosition(
  before: Board,
  committed: Board,
  assignment: AssignmentId,
  member: MemberId,
): PositionId | null {
  const approved = new Set(
    committed.approvals.filter((approval) => approval.memberId === member).map((approval) => approval.positionId),
  );
  const candidates = Object.values(committed.positions)
    .filter(
      (position) =>
        position.assignmentId === assignment &&
        committed.placements[position.id] === member &&
        before.placements[position.id] !== member &&
        !approved.has(position.id),
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, 'en'));
  return candidates[0]?.id ?? null;
}

type BoardWaiter = {
  readonly boardId: BoardId;
  readonly version: number;
  readonly resolve: (board: Board | null) => void;
};

export interface EditingLayerProps {
  readonly board: Board;
  readonly ward: Ward;
  /** The proposal view from the sync state, or null on Current. */
  readonly proposal: ProposalView | null;
  readonly baseline: Board | null;
  readonly me: Me | null;
  /** Current and Accepted boards. */
  readonly readOnly: boolean;
  readonly onCameraChange: (action: CameraAction) => void;
  readonly children: ReactNode;
}

/**
 * Desktop editing: one drag-and-drop surface around the canvas and the dugout
 * panel. Each completed drop is sent to the server one operation at a time.
 */
export function EditingLayer({
  board,
  ward,
  proposal,
  baseline,
  me,
  readOnly,
  onCameraChange,
  children,
}: EditingLayerProps): ReactElement {
  const { send } = useSync();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const boardRef = useRef(board);
  const waitersRef = useRef<BoardWaiter[]>([]);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    boardRef.current = board;
    const waiting = waitersRef.current;
    if (waiting.length === 0) return;
    waitersRef.current = waiting.filter((waiter) => {
      if (waiter.boardId !== board.id) {
        waiter.resolve(null);
        return false;
      }
      if (board.version >= waiter.version) {
        waiter.resolve(board);
        return false;
      }
      return true;
    });
  }, [board]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const waiting = waitersRef.current;
      waitersRef.current = [];
      for (const waiter of waiting) waiter.resolve(null);
    };
  }, []);

  /** Resolves with the synced board once it reaches `version`, or null if another board opens. */
  function committedBoard(boardId: BoardId, version: number): Promise<Board | null> {
    const shown = boardRef.current;
    if (shown.id !== boardId) return Promise.resolve(null);
    if (shown.version >= version) return Promise.resolve(shown);
    return new Promise((resolve) => {
      waitersRef.current = [...waitersRef.current, { boardId, version, resolve }];
    });
  }

  function fail(message: string): void {
    if (mountedRef.current) setFailure(message);
  }

  async function sendAll(ops: readonly DropOp[]): Promise<void> {
    const before = boardRef.current;
    const placement = ops[0];
    let placed: Extract<OpOutcome, { ok: true }> | null = null;
    for (const op of ops) {
      let next: DropOp = op;
      if (op.kind === 'approvePlacement' && placement?.kind === 'addToList' && placed !== null) {
        // B-031: a full list gets a position the server names. Approve that one.
        const committed = await committedBoard(before.id, placed.version);
        const positionId =
          committed === null
            ? null
            : committedListPosition(before, committed, placement.request.assignmentId, op.request.memberId);
        if (positionId === null) {
          fail("the new position for this approval wasn't found on the saved board");
          return;
        }
        next = { kind: 'approvePlacement', request: { memberId: op.request.memberId, positionId } };
      }
      const outcome = await send(next.kind, next.request);
      if (!outcome.ok) {
        // The sync banner already says the connection is offline.
        if (outcome.code !== 'offline') fail(outcome.message);
        return;
      }
      if (op === placement) placed = outcome;
    }
  }

  function onCommit(ops: readonly DropOp[]): void {
    setFailure(null);
    setSending(true);
    void sendAll(ops).finally(() => {
      if (mountedRef.current) setSending(false);
    });
  }

  function onHoverOpen(value: string): void {
    const target = parseZoomTarget(value);
    if (target !== null) onCameraChange({ type: 'enter', target });
  }

  const core = coreProposal(proposal, baseline, board);
  // Without the baseline, approvals can't be checked, so nothing is draggable yet.
  const locked = readOnly || core === null || sending;

  return (
    <div className="editing-layer">
      {failure === null ? null : (
        <div role="alert" className="editing-alert">
          <p className="editing-alert-text">{`Couldn't apply the change: ${failure}`}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setFailure(null);
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
      <DndSurface
        board={board}
        ward={ward}
        proposal={readOnly ? null : core}
        me={{ displayName: me?.displayName ?? '' }}
        readOnly={locked}
        onCommit={onCommit}
        onHoverOpen={onHoverOpen}
      >
        <div className="editing-layout">
          <div className="editing-canvas">{children}</div>
          <div className="editing-dugout" id={DUGOUT_REGION_ID} tabIndex={-1} data-editing-dugout="">
            <DugoutPanel board={board} ward={ward} />
          </div>
        </div>
      </DndSurface>
    </div>
  );
}

/** The root board group of a calling group (nested groups walk up their parents). */
function rootBoardGroup(board: Board, groupId: CallingGroupId): string | null {
  const seen = new Set<string>();
  let group = board.callingGroups[groupId];
  while (group !== undefined && !seen.has(group.id)) {
    seen.add(group.id);
    if (group.parent.kind === 'boardGroup') return group.parent.id;
    group = board.callingGroups[group.parent.id];
  }
  return null;
}

function zoomToGroup(board: Board, groupId: CallingGroupId, dispatch: (action: CameraAction) => void): boolean {
  const org = rootBoardGroup(board, groupId);
  if (org === null) return false;
  dispatch({ type: 'fit' });
  dispatch({ type: 'enter', target: { kind: 'org', id: org } });
  dispatch({ type: 'enter', target: { kind: 'group', id: groupId } });
  return true;
}

function SearchIcon(): ReactElement {
  return (
    <svg className="shell-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export interface ShellSearchProps {
  readonly board: Board | null;
  readonly ward: Ward | null;
  /** Board ids still listed as tabs (Current and proposals). */
  readonly tabBoardIds: readonly string[];
  readonly readOnly: boolean;
  readonly onSelectBoard: (boardId: string) => void;
  readonly onCameraChange: (action: CameraAction) => void;
}

/**
 * The header search. Boards seen this session stay searchable under
 * "All proposals & Current"; the active board is always the live one.
 */
export function ShellSearch({
  board,
  ward,
  tabBoardIds,
  readOnly,
  onSelectBoard,
  onCameraChange,
}: ShellSearchProps): ReactElement {
  const { send } = useSync();
  const rootRef = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlyMap<string, Board>>(() => new Map());
  // Canvas views do not render highlights yet; the ids are kept here for them.
  const [, setHighlight] = useState<SearchHighlight>({ memberIds: [], positionIds: [] });

  useEffect(() => {
    if (board === null) return;
    setSeen((previous) => {
      if (previous.get(board.id) === board) return previous;
      const next = new Map(previous);
      next.set(board.id, board);
      return next;
    });
  }, [board]);

  if (board === null || ward === null) {
    return (
      <label className="shell-search-field">
        <SearchIcon />
        <input
          className="shell-search"
          type="search"
          aria-label="Search people, callings, tags"
          placeholder="Search people, callings, tags"
          readOnly
        />
      </label>
    );
  }

  const active = board;
  const others = [...seen.values()].filter((item) => item.id !== active.id && tabBoardIds.includes(item.id));

  function leaveSearch(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && rootRef.current?.contains(focused) === true) focused.blur();
  }

  function openDugout(): void {
    const region = document.getElementById(DUGOUT_REGION_ID);
    if (region === null) return;
    if (typeof region.scrollIntoView === 'function') region.scrollIntoView({ block: 'nearest' });
    region.focus({ preventScroll: true });
  }

  /** Zooms to a group on `boardId`, opening that board first when it isn't active. */
  function goToGroup(boardId: string, groupId: CallingGroupId): void {
    const target = boardId === active.id ? active : seen.get(boardId);
    if (target === undefined) return;
    if (boardId !== active.id) onSelectBoard(boardId);
    zoomToGroup(target, groupId, onCameraChange);
  }

  function onNavigate(target: SearchTarget): void {
    switch (target.kind) {
      case 'person': {
        const first = callingsOf(active, target.memberId)[0];
        leaveSearch();
        if (first === undefined) {
          openDugout();
          return;
        }
        zoomToGroup(active, first.callingGroupId, onCameraChange);
        return;
      }
      case 'calling':
        leaveSearch();
        goToGroup(target.boardId, target.callingGroupId);
        return;
      case 'group': {
        leaveSearch();
        if (target.groupKind === 'callingGroup') {
          goToGroup(target.boardId, callingGroupId(target.id));
          return;
        }
        if (target.boardId !== active.id) onSelectBoard(target.boardId);
        onCameraChange({ type: 'fit' });
        onCameraChange({ type: 'enter', target: { kind: 'org', id: target.id } });
        return;
      }
      case 'tag':
        // SearchBox presses the tag filter; matches are highlighted, nothing moves.
        return;
    }
  }

  return (
    <div className="editing-search" ref={rootRef}>
      <SearchBox
        ward={ward}
        active={active}
        boards={[active, ...others]}
        readOnly={readOnly}
        onNavigate={onNavigate}
        onAddToDugout={(request) => {
          void send('addToDugout', request);
        }}
        onHighlight={setHighlight}
        onClose={() => undefined}
      />
    </div>
  );
}
