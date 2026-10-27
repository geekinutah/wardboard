import type { AssignmentId, BoardGroupId, CallingGroupId, MemberId, PositionId } from '../model/ids.ts';

/** An unfilled position of an enabled assignment. */
export interface Vacancy {
  readonly positionId: PositionId;
  readonly assignmentId: AssignmentId;
  readonly callingGroupId: CallingGroupId;
  readonly boardGroupId: BoardGroupId;
}

/** A position a member currently occupies, including a disabled assignment. */
export interface HeldCalling {
  readonly positionId: PositionId;
  readonly assignmentId: AssignmentId;
  readonly title: string;
  readonly callingGroupId: CallingGroupId;
  readonly boardGroupId: BoardGroupId;
}

/**
 * One dugout row. `explicit` is true when the member is in `dugoutInclusions`,
 * even if they also qualify automatically by holding no calling.
 */
export interface DugoutEntry {
  readonly memberId: MemberId;
  readonly explicit: boolean;
  readonly callings: readonly HeldCalling[];
}
