import type { Board } from '../model/types.ts';

/** Stable tag-operation error codes. Callers branch on `code`; `message` is for people. */
export const TAG_ERROR_CODES = ['invalid_name', 'duplicate_tag_name', 'not_found', 'board_not_editable'] as const;
export type TagErrorCode = (typeof TAG_ERROR_CODES)[number];

export interface TagError<C extends string = TagErrorCode> {
  readonly code: C;
  readonly message: string;
}

/**
 * Outcome of a ward-level tag operation. Success values are produced through
 * `createWard` / `createBoard`, so they are frozen and rechecked.
 */
export type TagResult<T, C extends string = TagErrorCode> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TagError<C> };

/**
 * Outcome of a proposal calling-tag edit. Distinct from `src/ops` results so
 * this module does not depend on that package. `version` is never changed.
 */
export type BoardTagResult<C extends string = 'board_not_editable' | 'not_found'> =
  | { readonly ok: true; readonly board: Board }
  | { readonly ok: false; readonly error: TagError<C> };

/** How a tag is used, for the delete confirmation (SPEC §6). */
export interface TagUsage {
  /** Members carrying the tag. Counted once per member, not per board. */
  readonly members: number;
  /** `(board, assignment)` pairs whose `preferredMemberTagIds` include the tag. */
  readonly callingPreferences: number;
  /** `(board, assignment)` pairs whose `callingTagIds` include the tag. */
  readonly callingTags: number;
}
