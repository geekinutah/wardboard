import type {
  AssignmentId,
  BoardGroupId,
  BoardId,
  CallingGroupId,
  MemberId,
  PositionId,
  TagId,
} from '../model/ids.ts';
import type { AssignmentOrigin, Board, MemberCategory } from '../model/types.ts';

export interface SearchFilters {
  vacant?: boolean;
  noCalling?: boolean;
  category?: MemberCategory;
  tagIds?: readonly TagId[];
}

export interface SearchInput {
  query: string;
  boards: readonly Board[];
  filters?: SearchFilters;
}

export interface PersonResult {
  memberId: MemberId;
  /** Fixed order: name, tag, external_calling. No duplicates. */
  matchedOn: readonly ('name' | 'tag' | 'external_calling')[];
  placements: readonly {
    boardId: BoardId;
    positionId: PositionId;
    assignmentId: AssignmentId;
    title: string;
  }[];
  /** Scoped boards where the member is in the dugout. */
  dugout: readonly { boardId: BoardId; explicit: boolean }[];
}

export interface CallingResult {
  boardId: BoardId;
  assignmentId: AssignmentId;
  title: string;
  origin: AssignmentOrigin;
  callingGroupId: CallingGroupId;
  boardGroupId: BoardGroupId;
  positions: readonly {
    positionId: PositionId;
    occupantId: MemberId | null;
    occupantRemoved: boolean;
  }[];
  vacantCount: number;
}

export interface TagSearchResult {
  tagId: TagId;
  name: string;
  memberIds: readonly MemberId[];
}

export interface GroupResult {
  boardId: BoardId;
  kind: 'boardGroup' | 'callingGroup';
  id: BoardGroupId | CallingGroupId;
  name: string;
  /** Enabled assignments in the group and its descendants. */
  positionCount: number;
  vacantCount: number;
}

export interface SearchResults {
  people: PersonResult[];
  callings: CallingResult[];
  tags: TagSearchResult[];
  groups: GroupResult[];
}
