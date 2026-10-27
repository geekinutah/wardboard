import type { MemberId, PositionId } from '../model/ids.ts';

/** Accepted-summary groups, in display order (SPEC §3). */
export const SUMMARY_GROUP_KEYS = [
  'bishop',
  'first_counselor',
  'second_counselor',
  'eq_presidency_stake',
  'eq_president',
] as const;
export type SummaryGroupKey = (typeof SUMMARY_GROUP_KEYS)[number];

export interface SummaryLine {
  readonly memberId: MemberId;
  readonly name: string;
  readonly positionId: PositionId;
  readonly text: string;
}

export interface SummaryGroup {
  readonly key: SummaryGroupKey;
  readonly heading: string;
  readonly callings: readonly SummaryLine[];
  readonly releases: readonly SummaryLine[];
}
