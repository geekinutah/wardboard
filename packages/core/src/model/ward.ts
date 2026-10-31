import { deepFreeze } from './freeze.ts';
import type { Result } from './result.ts';
import {
  MAX_NOTE_LENGTH,
  MEMBER_CATEGORIES,
  MEMBER_GENDERS,
  type Member,
  type Tag,
  type Ward,
  type WardInput,
} from './types.ts';
import {
  characterCount,
  checkIdList,
  copyArray,
  ErrorCollector,
  isBoolean,
  isIsoDate,
  isNonEmptyString,
  isOneOf,
  objectItems,
  recordEntries,
  trimmed,
} from './validate.ts';

/** Builds a fresh member with exactly the allowed fields; anything else on the input is dropped. */
function copyMember(input: Member): Member {
  return {
    id: input.id,
    name: trimmed(input.name),
    category: input.category,
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    photoRef: input.photoRef,
    note: input.note,
    tagIds: copyArray(input.tagIds),
    needsApproval: input.needsApproval,
    removedDate: input.removedDate,
    externalCallings: copyArray(input.externalCallings, (e) => ({
      unit: trimmed(e.unit),
      title: trimmed(e.title),
    })),
  };
}

function validateMember(key: string, member: Member, tags: ReadonlySet<string>, errors: ErrorCollector): void {
  const path = `members.${key}`;
  if (member.id !== key) {
    errors.add('invalid_field', `${path}.id`, `member id must equal its record key ${key}`);
  }
  if (!isNonEmptyString(member.name)) {
    errors.add('invalid_field', `${path}.name`, 'member name must not be empty');
  }
  if (!isOneOf(MEMBER_CATEGORIES, member.category)) {
    errors.add('invalid_field', `${path}.category`, `category must be one of ${MEMBER_CATEGORIES.join(', ')}`);
  }
  if (member.gender !== undefined && !isOneOf(MEMBER_GENDERS, member.gender)) {
    errors.add('invalid_field', `${path}.gender`, `gender must be one of ${MEMBER_GENDERS.join(', ')}`);
  }
  if (member.photoRef !== null && !isNonEmptyString(member.photoRef)) {
    errors.add('invalid_field', `${path}.photoRef`, 'photoRef must be null or a non-empty string');
  }
  const note: unknown = member.note;
  if (note !== null && (typeof note !== 'string' || characterCount(note) > MAX_NOTE_LENGTH)) {
    errors.add('invalid_field', `${path}.note`, `note must be null or at most ${String(MAX_NOTE_LENGTH)} characters`);
  }
  checkIdList(member.tagIds, `${path}.tagIds`, errors, (id) => tags.has(id), 'tag');
  if (!isBoolean(member.needsApproval)) {
    errors.add('invalid_field', `${path}.needsApproval`, 'needsApproval must be a boolean');
  }
  if (member.removedDate !== null && !isIsoDate(member.removedDate)) {
    errors.add('invalid_field', `${path}.removedDate`, 'removedDate must be null or a real calendar date (YYYY-MM-DD)');
  }
  for (const [index, calling] of objectItems(member.externalCallings, `${path}.externalCallings`, errors)) {
    const callingPath = `${path}.externalCallings[${String(index)}]`;
    if (!isNonEmptyString(calling.unit)) {
      errors.add('invalid_field', `${callingPath}.unit`, 'external calling unit must not be empty');
    }
    if (!isNonEmptyString(calling.title)) {
      errors.add('invalid_field', `${callingPath}.title`, 'external calling title must not be empty');
    }
  }
}

/**
 * Validates ward-wide data (members and the tag library) and returns a deeply
 * frozen, normalized copy. Collects every error rather than stopping at the first.
 */
export function createWard(input: WardInput): Result<Ward> {
  const errors = new ErrorCollector();

  const tags: Record<string, Tag> = {};
  const tagNames = new Map<string, string>();
  for (const [key, tag] of recordEntries(input.tags, 'tags', errors)) {
    const copy: Tag = { id: tag.id, name: trimmed(tag.name) };
    tags[key] = copy;
    if (copy.id !== key) {
      errors.add('invalid_field', `tags.${key}.id`, `tag id must equal its record key ${key}`);
    }
    if (!isNonEmptyString(copy.name)) {
      errors.add('invalid_field', `tags.${key}.name`, 'tag name must not be empty');
      continue;
    }
    const folded = copy.name.toLowerCase();
    const existing = tagNames.get(folded);
    if (existing === undefined) {
      tagNames.set(folded, key);
    } else {
      errors.add('duplicate_tag_name', `tags.${key}.name`, `tag name "${copy.name}" duplicates tag ${existing}`);
    }
  }

  const tagIds = new Set(Object.keys(tags));
  const members: Record<string, Member> = {};
  for (const [key, member] of recordEntries(input.members, 'members', errors)) {
    const copy = copyMember(member);
    members[key] = copy;
    validateMember(key, copy, tagIds, errors);
  }

  if (errors.errors.length > 0) {
    return { ok: false, errors: errors.errors };
  }
  const ward: Ward = {
    members: members,
    tags: tags,
  };
  return { ok: true, value: deepFreeze(ward) };
}
