import { preferenceMatches } from '@wardboard/core';
import type { AssignmentId, Board, MemberId, TagId, TagUsage, Ward } from '@wardboard/core';

/** Most suggestions the combobox lists at once. */
export const MAX_SUGGESTIONS = 8;

/** Members carrying each ward tag. Every ward tag has a key (0 when unused). */
export function memberCountByTag(ward: Ward): Record<TagId, number> {
  const counts: Record<string, number> = {};
  for (const id of Object.keys(ward.tags)) {
    counts[id] = 0;
  }
  for (const person of Object.values(ward.members)) {
    for (const id of new Set(person.tagIds)) {
      if (Object.hasOwn(counts, id)) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
  }
  return counts;
}

export interface TagSuggestion {
  readonly id: TagId;
  readonly name: string;
  readonly members: number;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** Combobox contents for `query`: matching uncarried ward tags, plus a create offer for a new name. */
export function tagSuggestions(
  ward: Ward,
  carried: readonly TagId[],
  query: string,
): { suggestions: TagSuggestion[]; create: string | null } {
  const q = query.trim();
  const needle = q.toLowerCase();
  const counts = memberCountByTag(ward);
  const taken = new Set<string>(carried);
  const tags = Object.values(ward.tags);
  const suggestions = tags
    .filter((tag) => !taken.has(tag.id) && tag.name.toLowerCase().includes(needle))
    .sort((a, b) => compareNames(a.name, b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map((tag) => ({ id: tag.id, name: tag.name, members: counts[tag.id] ?? 0 }));
  const exists = tags.some((tag) => tag.name.toLowerCase() === needle);
  return { suggestions, create: q !== '' && !exists ? q : null };
}

/** The members of `memberIds`, in input order, who carry at least one preferred tag. */
export function dugoutMatches(
  board: Board,
  ward: Ward,
  assignmentId: AssignmentId,
  memberIds: readonly MemberId[],
): MemberId[] {
  return memberIds.filter((id) => preferenceMatches(board, ward, assignmentId, id).length > 0);
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function deleteConfirmation(name: string, usage: TagUsage): { title: string; body: string } {
  let body = `Removes it from ${plural(usage.members, 'person', 'people')} and from the preferences on ${plural(usage.callingPreferences, 'calling', 'callings')}`;
  if (usage.callingTags > 0) {
    body += ` and the tags on ${plural(usage.callingTags, 'calling', 'callings')}`;
  }
  return { title: `Delete “${name}”?`, body: `${body}. Nothing else changes.` };
}
