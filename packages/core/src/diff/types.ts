import type { AssignmentId, LineageId, MemberId, PositionId } from '../model/ids.ts';

/** A member in a position, as it appears in a suggested calling or release. */
export interface DiffPlacement {
  readonly memberId: MemberId;
  readonly positionId: PositionId;
  readonly lineageId: LineageId;
  readonly assignmentId: AssignmentId;
  /** The assignment title on the board the position belongs to. */
  readonly title: string;
}

/** A position that exists on only one of the two boards. */
export interface DiffPosition {
  readonly positionId: PositionId;
  readonly lineageId: LineageId;
  readonly assignmentId: AssignmentId;
  /** The assignment title on the board the position belongs to. */
  readonly title: string;
}

/** The net change from an earlier board to a later one (SPEC §3, §7). */
export interface NetDiff {
  /** Suggested callings: positions on `to`, in `to`'s structural order. */
  readonly callings: readonly DiffPlacement[];
  /** Suggested releases: positions on `from`, in `from`'s structural order. */
  readonly releases: readonly DiffPlacement[];
  /** Positions on `to` whose lineage is absent from `from`, in `to`'s structural order. */
  readonly addedPositions: readonly DiffPosition[];
  /** Positions on `from` whose lineage is absent from `to`, in `from`'s structural order. */
  readonly removedPositions: readonly DiffPosition[];
}
