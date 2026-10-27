import { callingsOf, dugout, rootBoardGroupOf, vacancies } from '../derive/views.ts';
import { deepFreeze } from '../model/freeze.ts';
import type { AssignmentId, BoardGroupId, CallingGroupId, MemberId, PositionId, TagId } from '../model/ids.ts';
import type {
  Board,
  BoardGroup,
  CallingAssignment,
  CallingGroup,
  CallingGroupParent,
  Member,
  MemberCategory,
  Position,
  Ward,
} from '../model/types.ts';
import { normalizeSearchText } from './normalize.ts';
import type {
  CallingResult,
  GroupResult,
  PersonResult,
  SearchFilters,
  SearchInput,
  SearchResults,
} from './types.ts';

/*
 * Global search and one-board highlights (SPEC §10, §8, §12).
 * An empty normalized query is not a substring match.
 */

type MatchField = PersonResult['matchedOn'][number];

interface PeopleFilter {
  readonly noCalling: boolean;
  readonly category: MemberCategory | null;
  readonly tagIds: readonly TagId[];
}

interface ChainLink {
  readonly order: number;
  readonly id: CallingGroupId;
}

interface GroupLocation {
  readonly boardGroupId: BoardGroupId;
  readonly boardGroupOrder: number;
  readonly chain: readonly ChainLink[];
}

interface GroupKey {
  readonly boardGroupOrder: number;
  readonly boardGroupId: BoardGroupId;
  readonly chain: readonly ChainLink[];
}

interface AssignmentKey extends GroupKey {
  readonly assignmentOrder: number;
  readonly assignmentId: AssignmentId;
}

interface Slot {
  readonly position: Position;
  readonly assignment: CallingAssignment;
  readonly location: GroupLocation;
}

function peopleFilterFrom(filters: SearchFilters | undefined): PeopleFilter {
  return {
    noCalling: filters?.noCalling === true,
    category: filters?.category ?? null,
    tagIds: filters?.tagIds ?? [],
  };
}

function peopleFilterActive(filter: PeopleFilter): boolean {
  return filter.noCalling || filter.category !== null || filter.tagIds.length > 0;
}

function contains(query: string, value: string): boolean {
  return normalizeSearchText(value).includes(query);
}

function compareTextThenId(leftName: string, leftId: string, rightName: string, rightId: string): number {
  const byName = leftName.localeCompare(rightName, 'en', { sensitivity: 'base' });
  if (byName !== 0) {
    return byName;
  }
  return leftId.localeCompare(rightId, 'en');
}

function compareMembers(left: Member, right: Member): number {
  return compareTextThenId(left.name, left.id, right.name, right.id);
}

function requireCallingGroup(board: Board, id: CallingGroupId): CallingGroup {
  const group = board.callingGroups[id];
  if (group === undefined) {
    throw new Error(`calling group ${id} does not exist`);
  }
  return group;
}

function requireBoardGroup(board: Board, id: BoardGroupId): BoardGroup {
  const group = board.boardGroups[id];
  if (group === undefined) {
    throw new Error(`board group ${id} does not exist`);
  }
  return group;
}

function requireAssignment(board: Board, id: AssignmentId): CallingAssignment {
  const assignment = board.assignments[id];
  if (assignment === undefined) {
    throw new Error(`assignment ${id} does not exist`);
  }
  return assignment;
}

function occupantOf(board: Board, id: PositionId): MemberId | null {
  if (!Object.hasOwn(board.placements, id)) {
    return null;
  }
  const occupant = board.placements[id];
  return occupant ?? null;
}

/**
 * Walks parent links to the board group. `chain` starts at the calling group
 * directly under that board group and ends at `startId`. Same order as derive.
 */
function locateGroup(board: Board, startId: CallingGroupId): GroupLocation {
  const ascending: CallingGroup[] = [];
  const seen = new Set<CallingGroupId>();
  let cursor: CallingGroupId = startId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const group = requireCallingGroup(board, cursor);
    ascending.push(group);
    if (group.parent.kind === 'boardGroup') {
      const boardGroup = requireBoardGroup(board, group.parent.id);
      const chain: ChainLink[] = [];
      for (let index = ascending.length - 1; index >= 0; index -= 1) {
        const link = ascending[index];
        if (link === undefined) {
          throw new Error(`missing calling group while locating ${startId}`);
        }
        chain.push({ order: link.order, id: link.id });
      }
      return { boardGroupId: boardGroup.id, boardGroupOrder: boardGroup.order, chain };
    }
    cursor = group.parent.id;
  }
  throw new Error(`calling group ${cursor} is its own ancestor`);
}

function chainLink(chain: readonly ChainLink[], index: number): ChainLink {
  const link = chain[index];
  if (link === undefined) {
    throw new Error(`missing calling-group chain link ${String(index)}`);
  }
  return link;
}

/** An ancestor chain is a prefix of its descendant and sorts first. */
function compareChains(left: readonly ChainLink[], right: readonly ChainLink[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftLink = chainLink(left, index);
    const rightLink = chainLink(right, index);
    if (leftLink.order !== rightLink.order) {
      return leftLink.order - rightLink.order;
    }
    const byId = leftLink.id.localeCompare(rightLink.id, 'en');
    if (byId !== 0) {
      return byId;
    }
  }
  return left.length - right.length;
}

function compareGroupKeys(left: GroupKey, right: GroupKey): number {
  if (left.boardGroupOrder !== right.boardGroupOrder) {
    return left.boardGroupOrder - right.boardGroupOrder;
  }
  const byBoardGroup = left.boardGroupId.localeCompare(right.boardGroupId, 'en');
  if (byBoardGroup !== 0) {
    return byBoardGroup;
  }
  return compareChains(left.chain, right.chain);
}

function compareAssignmentKeys(left: AssignmentKey, right: AssignmentKey): number {
  const byGroup = compareGroupKeys(left, right);
  if (byGroup !== 0) {
    return byGroup;
  }
  if (left.assignmentOrder !== right.assignmentOrder) {
    return left.assignmentOrder - right.assignmentOrder;
  }
  return left.assignmentId.localeCompare(right.assignmentId, 'en');
}

function compareSlots(left: Slot, right: Slot): number {
  const byAssignment = compareAssignmentKeys(
    {
      boardGroupOrder: left.location.boardGroupOrder,
      boardGroupId: left.location.boardGroupId,
      chain: left.location.chain,
      assignmentOrder: left.assignment.order,
      assignmentId: left.assignment.id,
    },
    {
      boardGroupOrder: right.location.boardGroupOrder,
      boardGroupId: right.location.boardGroupId,
      chain: right.location.chain,
      assignmentOrder: right.assignment.order,
      assignmentId: right.assignment.id,
    },
  );
  if (byAssignment !== 0) {
    return byAssignment;
  }
  if (left.position.order !== right.position.order) {
    return left.position.order - right.position.order;
  }
  return left.position.id.localeCompare(right.position.id, 'en');
}

function holdsPosition(board: Board, memberId: MemberId): boolean {
  for (const occupant of Object.values(board.placements)) {
    if (occupant === memberId) {
      return true;
    }
  }
  return false;
}

function passesPeopleFilters(member: Member, filter: PeopleFilter, boards: readonly Board[]): boolean {
  if (filter.category !== null && member.category !== filter.category) {
    return false;
  }
  for (const tagId of filter.tagIds) {
    if (!member.tagIds.includes(tagId)) {
      return false;
    }
  }
  if (filter.noCalling) {
    for (const board of boards) {
      if (holdsPosition(board, member.id)) {
        return false;
      }
    }
  }
  return true;
}

function matchedFields(member: Member, ward: Ward, query: string): readonly MatchField[] | null {
  const matched: MatchField[] = [];
  if (contains(query, member.name)) {
    matched.push('name');
  }
  const tagHit = member.tagIds.some((id) => {
    const tag = ward.tags[id];
    return tag !== undefined && contains(query, tag.name);
  });
  if (tagHit) {
    matched.push('tag');
  }
  const externalHit = member.externalCallings.some(
    (calling) => contains(query, calling.title) || contains(query, calling.unit),
  );
  if (externalHit) {
    matched.push('external_calling');
  }
  return matched.length === 0 ? null : matched;
}

function placementsFor(memberId: MemberId, boards: readonly Board[]): PersonResult['placements'] {
  const placements: {
    boardId: Board['id'];
    positionId: PositionId;
    assignmentId: AssignmentId;
    title: string;
  }[] = [];
  for (const board of boards) {
    for (const held of callingsOf(board, memberId)) {
      placements.push({
        boardId: board.id,
        positionId: held.positionId,
        assignmentId: held.assignmentId,
        title: held.title,
      });
    }
  }
  return placements;
}

function dugoutFor(memberId: MemberId, boards: readonly Board[], ward: Ward): PersonResult['dugout'] {
  const dugoutState: { boardId: Board['id']; explicit: boolean }[] = [];
  for (const board of boards) {
    for (const entry of dugout(board, ward)) {
      if (entry.memberId === memberId) {
        dugoutState.push({ boardId: board.id, explicit: entry.explicit });
        break;
      }
    }
  }
  return dugoutState;
}

function collectPeople(
  ward: Ward,
  boards: readonly Board[],
  query: string,
  text: boolean,
  filter: PeopleFilter,
  filterActive: boolean,
): PersonResult[] {
  if (!text && !filterActive) {
    return [];
  }
  const matched: { member: Member; matchedOn: readonly MatchField[] }[] = [];
  for (const member of Object.values(ward.members)) {
    if (member.removedDate !== null) {
      continue;
    }
    const matchedOn = text ? matchedFields(member, ward, query) : [];
    if (matchedOn === null) {
      continue;
    }
    if (filterActive && !passesPeopleFilters(member, filter, boards)) {
      continue;
    }
    matched.push({ member, matchedOn });
  }
  matched.sort((left, right) => compareMembers(left.member, right.member));
  return matched.map(({ member, matchedOn }) => ({
    memberId: member.id,
    matchedOn,
    placements: placementsFor(member.id, boards),
    dugout: dugoutFor(member.id, boards, ward),
  }));
}

function occupiedAssignmentIds(board: Board): Set<AssignmentId> {
  const ids = new Set<AssignmentId>();
  for (const position of Object.values(board.positions)) {
    if (occupantOf(board, position.id) !== null) {
      ids.add(position.assignmentId);
    }
  }
  return ids;
}

function positionsOf(board: Board, ward: Ward, assignmentId: AssignmentId): CallingResult['positions'] {
  const positions = Object.values(board.positions).filter((position) => position.assignmentId === assignmentId);
  positions.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, 'en'));
  return positions.map((position) => {
    const occupantId = occupantOf(board, position.id);
    const occupant = occupantId === null ? undefined : ward.members[occupantId];
    return {
      positionId: position.id,
      occupantId,
      occupantRemoved: occupant !== undefined && occupant.removedDate !== null,
    };
  });
}

function vacancyCounts(board: Board): Map<AssignmentId, number> {
  const counts = new Map<AssignmentId, number>();
  for (const vacancy of vacancies(board)) {
    counts.set(vacancy.assignmentId, (counts.get(vacancy.assignmentId) ?? 0) + 1);
  }
  return counts;
}

function collectCallings(
  board: Board,
  ward: Ward,
  query: string,
  text: boolean,
  vacantOnly: boolean,
): CallingResult[] {
  const occupied = occupiedAssignmentIds(board);
  const vacantByAssignment = vacancyCounts(board);
  const ranked: { key: AssignmentKey; result: CallingResult }[] = [];
  for (const assignment of Object.values(board.assignments)) {
    if (!assignment.enabled && !occupied.has(assignment.id)) {
      continue;
    }
    if (text && !contains(query, assignment.title)) {
      continue;
    }
    // Same positions vacancies() counts: unfilled slots of an enabled assignment.
    const vacantCount = vacantByAssignment.get(assignment.id) ?? 0;
    if (vacantOnly && vacantCount < 1) {
      continue;
    }
    const location = locateGroup(board, assignment.groupId);
    ranked.push({
      key: {
        boardGroupOrder: location.boardGroupOrder,
        boardGroupId: location.boardGroupId,
        chain: location.chain,
        assignmentOrder: assignment.order,
        assignmentId: assignment.id,
      },
      result: {
        boardId: board.id,
        assignmentId: assignment.id,
        title: assignment.title,
        origin: assignment.origin,
        callingGroupId: assignment.groupId,
        boardGroupId: rootBoardGroupOf(board, assignment.groupId),
        positions: positionsOf(board, ward, assignment.id),
        vacantCount,
      },
    });
  }
  ranked.sort((left, right) => compareAssignmentKeys(left.key, right.key));
  return ranked.map((item) => item.result);
}

function collectTags(ward: Ward, query: string): SearchResults['tags'] {
  const tags: SearchResults['tags'] = [];
  for (const tag of Object.values(ward.tags)) {
    if (!contains(query, tag.name)) {
      continue;
    }
    const members = Object.values(ward.members).filter(
      (member) => member.removedDate === null && member.tagIds.includes(tag.id),
    );
    members.sort(compareMembers);
    tags.push({ tagId: tag.id, name: tag.name, memberIds: members.map((member) => member.id) });
  }
  tags.sort((left, right) => compareTextThenId(left.name, left.tagId, right.name, right.tagId));
  return tags;
}

function callingGroupsUnder(board: Board, root: CallingGroupParent): Set<CallingGroupId> {
  const ids = new Set<CallingGroupId>();
  const pending: CallingGroupId[] = [];
  if (root.kind === 'callingGroup') {
    pending.push(root.id);
  }
  for (const group of Object.values(board.callingGroups)) {
    if (group.parent.kind === root.kind && group.parent.id === root.id) {
      pending.push(group.id);
    }
  }
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || ids.has(id)) {
      continue;
    }
    ids.add(id);
    for (const group of Object.values(board.callingGroups)) {
      if (group.parent.kind === 'callingGroup' && group.parent.id === id && !ids.has(group.id)) {
        pending.push(group.id);
      }
    }
  }
  return ids;
}

function positionCountFor(board: Board, groupIds: ReadonlySet<CallingGroupId>): number {
  let count = 0;
  for (const position of Object.values(board.positions)) {
    const assignment = board.assignments[position.assignmentId];
    if (assignment !== undefined && assignment.enabled && groupIds.has(assignment.groupId)) {
      count += 1;
    }
  }
  return count;
}

function vacantCountFor(board: Board, groupIds: ReadonlySet<CallingGroupId>): number {
  let count = 0;
  for (const vacancy of vacancies(board)) {
    if (groupIds.has(vacancy.callingGroupId)) {
      count += 1;
    }
  }
  return count;
}

function collectGroups(board: Board, query: string): GroupResult[] {
  const ranked: { key: GroupKey; result: GroupResult }[] = [];
  for (const group of Object.values(board.boardGroups)) {
    if (!contains(query, group.name)) {
      continue;
    }
    const ids = callingGroupsUnder(board, { kind: 'boardGroup', id: group.id });
    ranked.push({
      key: { boardGroupOrder: group.order, boardGroupId: group.id, chain: [] },
      result: {
        boardId: board.id,
        kind: 'boardGroup',
        id: group.id,
        name: group.name,
        positionCount: positionCountFor(board, ids),
        vacantCount: vacantCountFor(board, ids),
      },
    });
  }
  for (const group of Object.values(board.callingGroups)) {
    if (!contains(query, group.name)) {
      continue;
    }
    const location = locateGroup(board, group.id);
    const ids = callingGroupsUnder(board, { kind: 'callingGroup', id: group.id });
    ranked.push({
      key: {
        boardGroupOrder: location.boardGroupOrder,
        boardGroupId: location.boardGroupId,
        chain: location.chain,
      },
      result: {
        boardId: board.id,
        kind: 'callingGroup',
        id: group.id,
        name: group.name,
        positionCount: positionCountFor(board, ids),
        vacantCount: vacantCountFor(board, ids),
      },
    });
  }
  ranked.sort((left, right) => compareGroupKeys(left.key, right.key));
  return ranked.map((item) => item.result);
}

function orderedPositionIds(board: Board, wanted: ReadonlySet<PositionId>): PositionId[] {
  const slots: Slot[] = [];
  for (const position of Object.values(board.positions)) {
    if (!wanted.has(position.id)) {
      continue;
    }
    const assignment = requireAssignment(board, position.assignmentId);
    slots.push({ position, assignment, location: locateGroup(board, assignment.groupId) });
  }
  slots.sort(compareSlots);
  return slots.map((slot) => slot.position.id);
}

function highlightMembers(board: Board, ward: Ward, filter: PeopleFilter): Member[] {
  if (!peopleFilterActive(filter)) {
    return [];
  }
  const members = Object.values(ward.members).filter(
    (member) => member.removedDate === null && passesPeopleFilters(member, filter, [board]),
  );
  members.sort(compareMembers);
  return members;
}

export function search(input: SearchInput, ward: Ward): SearchResults {
  const query = normalizeSearchText(input.query);
  const text = query !== '';
  const filter = peopleFilterFrom(input.filters);
  const peopleActive = peopleFilterActive(filter);
  const vacantOnly = input.filters?.vacant === true;
  const filtersActive = peopleActive || vacantOnly;
  const boards = input.boards;

  const callings: CallingResult[] = [];
  const groups: GroupResult[] = [];
  if (text || vacantOnly) {
    for (const board of boards) {
      callings.push(...collectCallings(board, ward, query, text, vacantOnly));
    }
  }
  if (text && !filtersActive) {
    for (const board of boards) {
      groups.push(...collectGroups(board, query));
    }
  }

  return deepFreeze({
    people: collectPeople(ward, boards, query, text, filter, peopleActive),
    callings,
    tags: text && !filtersActive ? collectTags(ward, query) : [],
    groups,
  });
}

export function filterMatches(
  board: Board,
  ward: Ward,
  filters: SearchFilters,
): { readonly memberIds: readonly MemberId[]; readonly positionIds: readonly PositionId[] } {
  const filter = peopleFilterFrom(filters);
  const members = highlightMembers(board, ward, filter);
  const memberIds = members.map((member) => member.id);
  const selected = new Set<MemberId>(memberIds);
  const wanted = new Set<PositionId>();
  if (filters.vacant === true) {
    for (const vacancy of vacancies(board)) {
      wanted.add(vacancy.positionId);
    }
  }
  for (const position of Object.values(board.positions)) {
    const occupantId = occupantOf(board, position.id);
    if (occupantId !== null && selected.has(occupantId)) {
      wanted.add(position.id);
    }
  }
  return deepFreeze({ memberIds, positionIds: orderedPositionIds(board, wanted) });
}
