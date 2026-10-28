import type {
  AddToDugoutRequest,
  AddToListRequest,
  MemberId,
  MoveToDugoutRequest,
  PlaceInPositionRequest,
  PositionId,
  ReleaseOccupantRequest,
  SwapRequest,
} from '@wardboard/core';

/**
 * One operation a drop produces. `kind` is the server operation registry name,
 * so a host can send `send(op.kind, op.request)` directly.
 */
export type DropOp =
  | { kind: 'placeInPosition'; request: PlaceInPositionRequest }
  | { kind: 'addToList'; request: AddToListRequest }
  | { kind: 'swap'; request: SwapRequest }
  | { kind: 'releaseOccupant'; request: ReleaseOccupantRequest }
  | { kind: 'moveToDugout'; request: MoveToDugoutRequest }
  | { kind: 'addToDugout'; request: AddToDugoutRequest }
  | { kind: 'approvePlacement'; request: { memberId: MemberId; positionId: PositionId } };

/** What is being dragged. */
export type DragSource =
  | { kind: 'position'; memberId: MemberId; positionId: PositionId } // a card in a calling
  | { kind: 'dugout'; memberId: MemberId } // a dugout row
  | { kind: 'member'; memberId: MemberId }; // any other member card (Out-of-Unit view, inspector)

/** Where it was dropped. */
export type DropTarget = { kind: 'position'; positionId: PositionId } | { kind: 'dugout' };
