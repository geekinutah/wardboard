/**
 * Pure checks for member-profile messages. Lengths count code points so they
 * match SQLite `length()` and core `createWard` (a surrogate pair is one character).
 */

export type MemberProfilePatch = {
  readonly name?: string;
  readonly note?: string | null;
  readonly tagIds?: readonly string[];
};

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const NAME_MAX = 100;
const NOTE_MAX = 280;
const TAG_NAME_MAX = 40;
const TAG_IDS_MAX = 20;
const PATCH_KEYS = new Set(['name', 'note', 'tagIds']);

function fail(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message };
}

function characters(value: string): number {
  return Array.from(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMemberName(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return fail('name must be a string');
  const name = value.trim();
  const count = characters(name);
  if (count < 1 || count > NAME_MAX) return fail('name must be 1 to 100 characters');
  return { ok: true, value: name };
}

export function parseMemberNote(value: unknown): ParseResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('note must be a string or null');
  const note = value.trim();
  if (note.length === 0) return { ok: true, value: null };
  if (characters(note) > NOTE_MAX) return fail('note must be at most 280 characters');
  return { ok: true, value: note };
}

export function parseTagName(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return fail('tag name must be a string');
  const name = value.trim();
  const count = characters(name);
  if (count < 1 || count > TAG_NAME_MAX) return fail('tag name must be 1 to 40 characters');
  return { ok: true, value: name };
}

export function parseTagIds(value: unknown): ParseResult<readonly string[]> {
  if (!Array.isArray(value)) return fail('tagIds must be an array');
  if (value.length > TAG_IDS_MAX) return fail('tagIds must contain at most 20 tags');
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      return fail('tagIds must be non-empty strings');
    }
    if (seen.has(item)) return fail('tagIds must not contain duplicates');
    seen.add(item);
    ids.push(item);
  }
  return { ok: true, value: ids };
}

export function parseMemberPatch(value: unknown): ParseResult<MemberProfilePatch> {
  if (!isRecord(value)) return fail('patch must be an object');
  const keys = Object.keys(value);
  if (keys.length === 0) return fail('patch must include name, note, or tagIds');
  for (const key of keys) {
    if (!PATCH_KEYS.has(key)) return fail('patch has an unknown key');
  }
  const patch: { name?: string; note?: string | null; tagIds?: readonly string[] } = {};
  if (Object.hasOwn(value, 'name')) {
    const name = parseMemberName(value.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if (Object.hasOwn(value, 'note')) {
    const note = parseMemberNote(value.note);
    if (!note.ok) return note;
    patch.note = note.value;
  }
  if (Object.hasOwn(value, 'tagIds')) {
    const tagIds = parseTagIds(value.tagIds);
    if (!tagIds.ok) return tagIds;
    patch.tagIds = tagIds.value;
  }
  return { ok: true, value: patch };
}
