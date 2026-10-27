import { createBoard } from '../model/board.ts';
import { tagId, type AssignmentId, type IdGenerator, type MemberId, type TagId } from '../model/ids.ts';
import type { Board, CallingAssignment, Member, Tag, Ward } from '../model/types.ts';
import { createWard } from '../model/ward.ts';
import type { BoardTagResult, TagError, TagResult, TagUsage } from './types.ts';

/*
 * Ward-wide tags and board-owned calling tags / affinities (SPEC §6, §7).
 *
 * Preferences are informational only: nothing here ranks or rejects a member.
 * `needsApproval` is not a tag and is never changed. Deleting a tag strips it
 * from every supplied board, including Current and baselines, so no dangling
 * tag id remains. Calling-tag edits apply only to proposal boards and do not
 * change `version`.
 */

function fail<C extends string>(code: C, message: string): { readonly ok: false; readonly error: TagError<C> } {
  return { ok: false, error: { code, message } };
}

/** Throws when a tag edit produces a ward `createWard` rejects. That is a programming error. */
function finalizeWard(input: Ward): Ward {
  const result = createWard(input);
  if (!result.ok) {
    const details = result.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join('; ');
    throw new Error(`tag operation produced an invalid ward: ${details}`);
  }
  return result.value;
}

/** Throws when a tag edit produces a board `createBoard` rejects. That is a programming error. */
function finalizeBoard(input: Board, ward: Ward): Board {
  const result = createBoard(input, ward);
  if (!result.ok) {
    const details = result.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join('; ');
    throw new Error(`tag operation produced an invalid board ${input.id}: ${details}`);
  }
  return result.value;
}

function uniqueTagIds(ids: readonly TagId[]): readonly TagId[] {
  const seen = new Set<string>();
  const unique: TagId[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function duplicateOf(ward: Ward, name: string, exceptId?: TagId): Tag | undefined {
  const folded = name.toLowerCase();
  return Object.values(ward.tags).find((tag) => tag.id !== exceptId && tag.name.toLowerCase() === folded);
}

function nameError(trimmedName: string): { readonly ok: false; readonly error: TagError<'invalid_name'> } | undefined {
  if (trimmedName === '') {
    return fail('invalid_name', 'tag name must not be empty');
  }
  return undefined;
}

function duplicateError(
  ward: Ward,
  trimmedName: string,
  exceptId?: TagId,
): { readonly ok: false; readonly error: TagError<'duplicate_tag_name'> } | undefined {
  const existing = duplicateOf(ward, trimmedName, exceptId);
  if (existing === undefined) {
    return undefined;
  }
  return fail('duplicate_tag_name', `tag name "${trimmedName}" duplicates tag ${existing.id}`);
}

export function createTag(
  ward: Ward,
  ids: IdGenerator,
  name: string,
): TagResult<{ readonly ward: Ward; readonly tagId: TagId }> {
  const trimmedName = name.trim();
  const empty = nameError(trimmedName);
  if (empty !== undefined) {
    return empty;
  }
  const duplicate = duplicateError(ward, trimmedName);
  if (duplicate !== undefined) {
    return duplicate;
  }
  const id = tagId(ids());
  if (ward.tags[id] !== undefined) {
    throw new Error(`tag operation was given an id that already exists: ${id}`);
  }
  const next: Ward = {
    members: ward.members,
    tags: { ...ward.tags, [id]: { id, name: trimmedName } },
  };
  return { ok: true, value: { ward: finalizeWard(next), tagId: id } };
}

export function renameTag(ward: Ward, id: TagId, name: string): TagResult<Ward> {
  if (ward.tags[id] === undefined) {
    return fail('not_found', `tag ${id} does not exist`);
  }
  const trimmedName = name.trim();
  const empty = nameError(trimmedName);
  if (empty !== undefined) {
    return empty;
  }
  const duplicate = duplicateError(ward, trimmedName, id);
  if (duplicate !== undefined) {
    return duplicate;
  }
  const next: Ward = {
    members: ward.members,
    tags: { ...ward.tags, [id]: { id, name: trimmedName } },
  };
  return { ok: true, value: finalizeWard(next) };
}

export function setMemberTags(ward: Ward, memberId: MemberId, tagIds: readonly TagId[]): TagResult<Ward> {
  const person = ward.members[memberId];
  if (person === undefined) {
    return fail('not_found', `member ${memberId} does not exist`);
  }
  const unique = uniqueTagIds(tagIds);
  const missing = unique.find((id) => ward.tags[id] === undefined);
  if (missing !== undefined) {
    return fail('not_found', `tag ${missing} does not exist`);
  }
  const next: Ward = {
    tags: ward.tags,
    members: { ...ward.members, [memberId]: { ...person, tagIds: unique } },
  };
  return { ok: true, value: finalizeWard(next) };
}

export function tagUsage(ward: Ward, boards: readonly Board[], id: TagId): TagUsage {
  let members = 0;
  for (const person of Object.values(ward.members)) {
    if (person.tagIds.includes(id)) {
      members += 1;
    }
  }
  let callingPreferences = 0;
  let callingTags = 0;
  for (const board of boards) {
    for (const calling of Object.values(board.assignments)) {
      if (calling.preferredMemberTagIds.includes(id)) {
        callingPreferences += 1;
      }
      if (calling.callingTagIds.includes(id)) {
        callingTags += 1;
      }
    }
  }
  return { members, callingPreferences, callingTags };
}

function omitTag(tags: Ward['tags'], id: TagId): Ward['tags'] {
  const next: Record<string, Tag> = {};
  for (const [key, tag] of Object.entries(tags)) {
    if (key !== id) {
      next[key] = tag;
    }
  }
  return next;
}

function membersWithout(members: Ward['members'], id: TagId): Ward['members'] {
  const next: Record<string, Member> = {};
  for (const [key, person] of Object.entries(members)) {
    if (person.tagIds.includes(id)) {
      next[key] = { ...person, tagIds: person.tagIds.filter((tag) => tag !== id) };
    } else {
      next[key] = person;
    }
  }
  return next;
}

function boardWithoutTag(board: Board, id: TagId): Board {
  let changed = false;
  const assignments: Record<string, CallingAssignment> = {};
  for (const [key, calling] of Object.entries(board.assignments)) {
    const callingTagIds = calling.callingTagIds.filter((tag) => tag !== id);
    const preferredMemberTagIds = calling.preferredMemberTagIds.filter((tag) => tag !== id);
    if (
      callingTagIds.length !== calling.callingTagIds.length ||
      preferredMemberTagIds.length !== calling.preferredMemberTagIds.length
    ) {
      changed = true;
      assignments[key] = { ...calling, callingTagIds, preferredMemberTagIds };
    } else {
      assignments[key] = calling;
    }
  }
  if (!changed) {
    return board;
  }
  return { ...board, assignments };
}

export function deleteTag(
  ward: Ward,
  boards: readonly Board[],
  id: TagId,
): TagResult<{ readonly ward: Ward; readonly boards: readonly Board[] }> {
  if (ward.tags[id] === undefined) {
    return fail('not_found', `tag ${id} does not exist`);
  }
  const nextWard = finalizeWard({
    tags: omitTag(ward.tags, id),
    members: membersWithout(ward.members, id),
  });
  const nextBoards = boards.map((board) => finalizeBoard(boardWithoutTag(board, id), nextWard));
  return { ok: true, value: { ward: nextWard, boards: nextBoards } };
}

function refusedBoard(board: Board): { readonly ok: false; readonly error: TagError<'board_not_editable'> } | undefined {
  if (board.kind === 'proposal') {
    return undefined;
  }
  return fail('board_not_editable', `board ${board.id} is ${board.kind} and cannot be edited`);
}

function setAssignmentTags(
  board: Board,
  ward: Ward,
  id: AssignmentId,
  tagIds: readonly TagId[],
  field: 'callingTagIds' | 'preferredMemberTagIds',
): BoardTagResult {
  const blocked = refusedBoard(board);
  if (blocked !== undefined) {
    return blocked;
  }
  const calling = board.assignments[id];
  if (calling === undefined) {
    return fail('not_found', `assignment ${id} does not exist`);
  }
  const unique = uniqueTagIds(tagIds);
  const missing = unique.find((tag) => ward.tags[tag] === undefined);
  if (missing !== undefined) {
    return fail('not_found', `tag ${missing} does not exist`);
  }
  const updated: CallingAssignment =
    field === 'callingTagIds' ? { ...calling, callingTagIds: unique } : { ...calling, preferredMemberTagIds: unique };
  const next: Board = {
    ...board,
    assignments: { ...board.assignments, [id]: updated },
  };
  return { ok: true, board: finalizeBoard(next, ward) };
}

export function setCallingTags(
  board: Board,
  ward: Ward,
  assignmentId: AssignmentId,
  tagIds: readonly TagId[],
): BoardTagResult {
  return setAssignmentTags(board, ward, assignmentId, tagIds, 'callingTagIds');
}

export function setCallingPreferences(
  board: Board,
  ward: Ward,
  assignmentId: AssignmentId,
  tagIds: readonly TagId[],
): BoardTagResult {
  return setAssignmentTags(board, ward, assignmentId, tagIds, 'preferredMemberTagIds');
}

/** Preferred tags the member carries, in preference-list order. Not an eligibility judgment. */
export function preferenceMatches(
  board: Board,
  ward: Ward,
  assignmentId: AssignmentId,
  memberId: MemberId,
): readonly TagId[] {
  const calling = board.assignments[assignmentId];
  const person = ward.members[memberId];
  if (calling === undefined || person === undefined) {
    return [];
  }
  const carried = new Set<string>(person.tagIds);
  return calling.preferredMemberTagIds.filter((id) => carried.has(id));
}
