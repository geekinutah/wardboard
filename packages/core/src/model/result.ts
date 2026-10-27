/** Stable validation error codes. Later tasks and the UI branch on these. */
export const VALIDATION_ERROR_CODES = [
  'invalid_field',
  'dangling_reference',
  'group_cycle',
  'single_position_count',
  'list_duplicate_member',
  'duplicate_lineage',
  'duplicate_key',
  'fixed_oversight',
  'duplicate_oversight',
  'approval_not_placed',
  'duplicate_tag_name',
  'board_kind',
] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export interface ValidationError {
  readonly code: ValidationErrorCode;
  /** Dotted path to the offending value, e.g. `members.m-0001.name` or `oversight[2].target`. */
  readonly path: string;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };
