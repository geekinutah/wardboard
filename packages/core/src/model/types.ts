import type {
  AssignmentId,
  BoardGroupId,
  BoardId,
  CallingGroupId,
  LineageId,
  MemberId,
  PositionId,
  ProposalId,
  TagId,
  UserId,
} from './ids.ts';

// ---------------------------------------------------------------------------
// Enumerations (runtime lists double as the source of the literal types)
// ---------------------------------------------------------------------------

export const MEMBER_CATEGORIES = ['adult', 'youth'] as const;
export type MemberCategory = (typeof MEMBER_CATEGORIES)[number];

export const BOARD_KINDS = ['current', 'proposal', 'baseline'] as const;
/** `current` is the imported board; `proposal` a proposal's working board; `baseline` its saved snapshot. */
export type BoardKind = (typeof BOARD_KINDS)[number];

/** Well-known board groups (SPEC §4 starting board groups). */
export const BOARD_GROUP_KEYS = [
  'bishopric',
  'elders_quorum',
  'relief_society',
  'aaronic_priesthood',
  'young_women',
  'primary',
  'sunday_school',
  'ward_wide',
] as const;
export type BoardGroupKey = (typeof BOARD_GROUP_KEYS)[number];

export const CALLING_GROUP_KINDS = ['presidency', 'bishopric', 'quorum', 'class', 'committee', 'other'] as const;
export type CallingGroupKind = (typeof CALLING_GROUP_KINDS)[number];

export const CALLING_GROUP_PARENT_KINDS = ['boardGroup', 'callingGroup'] as const;

export const ASSIGNMENT_TYPES = ['single', 'list'] as const;
/** `single`: exactly one position. `list`: a collection of roster positions. */
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_ORIGINS = ['standard', 'custom'] as const;
export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export const LEADERSHIP_ROLES = ['president', 'counselor', 'secretary'] as const;
export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number];

export const OVERSEERS = ['bishop', 'first_counselor', 'second_counselor'] as const;
export type Overseer = (typeof OVERSEERS)[number];

export const OVERSIGHT_TARGET_KINDS = ['boardGroup', 'callingGroup'] as const;

export const PROPOSAL_STATUSES = ['draft', 'accepted'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Calling-group key of the priests quorum, whose bishop oversight is fixed by office. */
export const PRIESTS_QUORUM_KEY = 'priests_quorum';

/** Maximum member note length, in characters (matches the SQLite schema). */
export const MAX_NOTE_LENGTH = 280;

// ---------------------------------------------------------------------------
// Ward-wide data (shared by Current and every proposal)
// ---------------------------------------------------------------------------

export interface ExternalCalling {
  readonly unit: string;
  readonly title: string;
}

/**
 * A ward member. Deliberately minimal (SPEC §6, §7, §15): no contact details,
 * birth date or age, gender, or any Church identifier.
 */
export interface Member {
  readonly id: MemberId;
  readonly name: string;
  readonly category: MemberCategory;
  readonly photoRef: string | null;
  readonly note: string | null;
  readonly tagIds: readonly TagId[];
  readonly needsApproval: boolean;
  /** ISO `YYYY-MM-DD`; null while the member is in Current. */
  readonly removedDate: string | null;
  readonly externalCallings: readonly ExternalCalling[];
}

export interface Tag {
  readonly id: TagId;
  readonly name: string;
}

export interface Ward {
  readonly members: Readonly<Record<MemberId, Member>>;
  readonly tags: Readonly<Record<TagId, Tag>>;
}

// ---------------------------------------------------------------------------
// Board-owned data (Current, a proposal's board, and its baseline)
// ---------------------------------------------------------------------------

export interface BoardGroup {
  readonly id: BoardGroupId;
  readonly name: string;
  readonly order: number;
  readonly visible: boolean;
  readonly key: BoardGroupKey | null;
}

export type CallingGroupParent =
  | { readonly kind: 'boardGroup'; readonly id: BoardGroupId }
  | { readonly kind: 'callingGroup'; readonly id: CallingGroupId };

export interface CallingGroup {
  readonly id: CallingGroupId;
  readonly name: string;
  readonly order: number;
  readonly parent: CallingGroupParent;
  readonly kind: CallingGroupKind;
  /** Well-known group key such as `priests_quorum`; unique per board when non-null. */
  readonly key: string | null;
}

export interface CallingAssignment {
  readonly id: AssignmentId;
  readonly groupId: CallingGroupId;
  readonly title: string;
  readonly type: AssignmentType;
  readonly order: number;
  readonly enabled: boolean;
  /** Overview prominence. */
  readonly prominent: boolean;
  readonly origin: AssignmentOrigin;
  /** The bishop is `president` of the `bishopric` group. */
  readonly leadershipRole: LeadershipRole | null;
  readonly callingTagIds: readonly TagId[];
  /** Affinities: preferred member tags. Preferences, never requirements. */
  readonly preferredMemberTagIds: readonly TagId[];
}

/** A persistent calling slot / roster position, occupied or vacant. */
export interface Position {
  readonly id: PositionId;
  readonly assignmentId: AssignmentId;
  /** Connects corresponding positions across boards for comparison. Unique per board. */
  readonly lineageId: LineageId;
  readonly order: number;
}

export type OversightTarget =
  | { readonly kind: 'boardGroup'; readonly id: BoardGroupId }
  | { readonly kind: 'callingGroup'; readonly id: CallingGroupId };

/** Assignment of a bishopric member to an area. Not a calling. */
export interface Oversight {
  readonly overseer: Overseer;
  readonly target: OversightTarget;
  /** Only bishop → priests quorum is fixed. */
  readonly fixed: boolean;
}

/** Explicit approval of a needs-approval member for one position on one board. */
export interface Approval {
  readonly memberId: MemberId;
  readonly positionId: PositionId;
  readonly approvedBy: UserId;
  /** ISO timestamp. */
  readonly approvedAt: string;
}

export interface Board {
  readonly id: BoardId;
  readonly kind: BoardKind;
  readonly version: number;
  readonly boardGroups: Readonly<Record<BoardGroupId, BoardGroup>>;
  readonly callingGroups: Readonly<Record<CallingGroupId, CallingGroup>>;
  readonly assignments: Readonly<Record<AssignmentId, CallingAssignment>>;
  readonly positions: Readonly<Record<PositionId, Position>>;
  /** Occupant per position; absent key means vacant. A member may occupy many positions. */
  readonly placements: Readonly<Record<PositionId, MemberId>>;
  readonly oversight: readonly Oversight[];
  /** Explicit dugout inclusions only; derived no-calling membership is computed elsewhere. */
  readonly dugoutInclusions: readonly MemberId[];
  readonly approvals: readonly Approval[];
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export interface ProposalAcceptance {
  readonly by: UserId;
  /** ISO timestamp. */
  readonly at: string;
  /** Callings-and-releases summary frozen at acceptance. */
  readonly summary: string;
}

export interface Proposal {
  readonly id: ProposalId;
  readonly name: string;
  readonly rationale: string | null;
  readonly status: ProposalStatus;
  /** Non-null iff `status` is `accepted`. */
  readonly accepted: ProposalAcceptance | null;
  /** Snapshot of Current when the proposal started (kind `baseline`). */
  readonly baseline: Board;
  /** The editable proposed arrangement (kind `proposal`). */
  readonly board: Board;
  readonly tabOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Constructor inputs have the same shape as the values they produce; they are
// untrusted until a constructor validates them.
export type WardInput = Ward;
export type BoardInput = Board;
export type ProposalInput = Proposal;
