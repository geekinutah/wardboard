import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  boardGroupId,
  callingGroupId,
  removedState,
  type AddAssignmentRequest,
  type AddCallingGroupRequest,
  type Board,
  type BoardGroupId,
  type Proposal,
  type RemovedState,
  type SetOversightRequest,
  type Ward,
} from '@wardboard/core';
import type { Camera, CameraAction, ZoomTarget } from '../features/canvas/camera.ts';
import { AaronicView } from '../features/aaronic/AaronicView.tsx';
import { GroupDetail } from '../features/group-view/GroupDetail.tsx';
import { OrganizationView } from '../features/org-view/OrganizationView.tsx';
import { removedRows, type RemovedRows } from '../features/removed/rows.ts';
import { WardOverview } from '../features/ward-overview/WardOverview.tsx';
import type { ProposalView } from '../sync/protocol.ts';
import { useSync } from '../sync/react.tsx';

export interface BoardLevelContext {
  readonly board: Board;
  readonly ward: Ward;
  readonly baseline: Board | null;
  readonly selection: ZoomTarget | null;
  readonly readOnly: boolean;
  readonly removed?: RemovedState | undefined;
  readonly onAddPosition: (request: AddAssignmentRequest) => void;
  readonly onAddGroup: (request: AddCallingGroupRequest) => void;
  readonly onSetOversight: (request: SetOversightRequest) => void;
  readonly onCameraChange: (action: CameraAction) => void;
  readonly onOpenBishopric?: (() => void) | undefined;
}

function overviewSelection(selection: ZoomTarget | null): BoardGroupId | undefined {
  if (selection === null || selection.kind !== 'org') return undefined;
  return boardGroupId(selection.id);
}

export function renderBoardLevel(levelCamera: Camera, ctx: BoardLevelContext): ReactNode {
  if (levelCamera.level === 1) {
    return (
      <WardOverview
        board={ctx.board}
        ward={ctx.ward}
        baseline={ctx.baseline}
        selectedId={overviewSelection(ctx.selection)}
      />
    );
  }
  if (levelCamera.level === 2 && levelCamera.orgId !== null) {
    const orgId = boardGroupId(levelCamera.orgId);
    const group = ctx.board.boardGroups[orgId];
    if (group?.key === 'aaronic_priesthood') {
      const bishopric = Object.values(ctx.board.boardGroups).find((g) => g.key === 'bishopric');
      const onOpenBishopric =
        ctx.onOpenBishopric ??
        (bishopric === undefined
          ? undefined
          : () => {
              ctx.onCameraChange({ type: 'up' });
              ctx.onCameraChange({ type: 'enter', target: { kind: 'org', id: bishopric.id } });
            });
      return (
        <AaronicView
          board={ctx.board}
          ward={ctx.ward}
          baseline={ctx.baseline}
          boardGroupId={orgId}
          readOnly={ctx.readOnly}
          onSetOversight={ctx.onSetOversight}
          onOpenBishopric={onOpenBishopric}
        />
      );
    }
    return (
      <OrganizationView
        board={ctx.board}
        ward={ctx.ward}
        baseline={ctx.baseline}
        boardGroupId={orgId}
        removed={ctx.removed}
      />
    );
  }
  if (levelCamera.level === 3 && levelCamera.groupId !== null) {
    return (
      <GroupDetail
        board={ctx.board}
        ward={ctx.ward}
        baseline={ctx.baseline}
        callingGroupId={callingGroupId(levelCamera.groupId)}
        readOnly={ctx.readOnly}
        onAddPosition={ctx.onAddPosition}
        onAddGroup={ctx.onAddGroup}
        removed={ctx.removed}
      />
    );
  }
  return null;
}

export function useCurrentBoard(): Board | null {
  const { boards, proposal, fetchBoard, status } = useSync();
  const currentBoardId = proposal !== null && boards?.current ? boards.current.boardId : null;
  const [currentBoards, setCurrentBoards] = useState<Record<string, Board>>({});
  const requestedCurrentIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (currentBoardId === null || status !== 'live') return;
    if (currentBoards[currentBoardId] !== undefined) return;
    if (requestedCurrentIds.current.has(currentBoardId)) return;
    requestedCurrentIds.current.add(currentBoardId);

    let cancelled = false;
    void fetchBoard(currentBoardId).then((fetched) => {
      if (cancelled || fetched === null) {
        requestedCurrentIds.current.delete(currentBoardId);
        return;
      }
      setCurrentBoards((prev) => (prev[currentBoardId] === fetched ? prev : { ...prev, [currentBoardId]: fetched }));
    });
    return () => {
      cancelled = true;
    };
  }, [currentBoardId, fetchBoard, currentBoards, status]);

  if (currentBoardId === null) return null;
  return currentBoards[currentBoardId] ?? null;
}

export function useRemovedState(
  proposal: ProposalView | null,
  baseline: Board | null,
  board: Board | null,
  ward: Ward | null,
  currentBoard: Board | null,
): { removed: RemovedState | undefined; summaryRows: RemovedRows | null } {
  if (
    proposal === null ||
    baseline === null ||
    board === null ||
    ward === null ||
    currentBoard === null ||
    currentBoard.kind !== 'current'
  ) {
    return { removed: undefined, summaryRows: null };
  }

  const fullProposal: Proposal = {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    accepted: null,
    tabOrder: 0,
    createdAt: '',
    updatedAt: '',
    baseline,
    board,
  };

  return {
    removed: removedState(fullProposal, currentBoard, ward),
    summaryRows: removedRows(fullProposal, currentBoard, ward),
  };
}
