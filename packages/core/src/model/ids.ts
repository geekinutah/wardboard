/**
 * Branded id types. Brands exist only at the type level (erasable syntax), so
 * at runtime every id is a plain string.
 */
type Brand<Name extends string> = string & { readonly __brand: Name };

export type MemberId = Brand<'MemberId'>;
export type TagId = Brand<'TagId'>;
export type BoardId = Brand<'BoardId'>;
export type BoardGroupId = Brand<'BoardGroupId'>;
export type CallingGroupId = Brand<'CallingGroupId'>;
export type AssignmentId = Brand<'AssignmentId'>;
export type PositionId = Brand<'PositionId'>;
export type LineageId = Brand<'LineageId'>;
export type UserId = Brand<'UserId'>;
export type ProposalId = Brand<'ProposalId'>;

export function memberId(value: string): MemberId {
  return value as MemberId;
}
export function tagId(value: string): TagId {
  return value as TagId;
}
export function boardId(value: string): BoardId {
  return value as BoardId;
}
export function boardGroupId(value: string): BoardGroupId {
  return value as BoardGroupId;
}
export function callingGroupId(value: string): CallingGroupId {
  return value as CallingGroupId;
}
export function assignmentId(value: string): AssignmentId {
  return value as AssignmentId;
}
export function positionId(value: string): PositionId {
  return value as PositionId;
}
export function lineageId(value: string): LineageId {
  return value as LineageId;
}
export function userId(value: string): UserId {
  return value as UserId;
}
export function proposalId(value: string): ProposalId {
  return value as ProposalId;
}

/** Produces a fresh id on each call. */
export type IdGenerator = () => string;

/**
 * Deterministic id generator: `sequentialIds('p')` yields `p-0001`, `p-0002`, ...
 * Each generator has its own counter; nothing is shared between generators.
 */
export function sequentialIds(prefix: string): IdGenerator {
  let next = 1;
  return () => {
    const id = `${prefix}-${String(next).padStart(4, '0')}`;
    next += 1;
    return id;
  };
}
