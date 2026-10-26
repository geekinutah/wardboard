import type { ValidationError, ValidationErrorCode } from './result.ts';

/**
 * Shared validation helpers. Inputs arrive typed but untrusted (they may come
 * from JSON), so these helpers take `unknown` and check at runtime.
 */

/** Collects errors under a path prefix (e.g. `baseline.` for a proposal's baseline). */
export class ErrorCollector {
  readonly errors: ValidationError[] = [];
  readonly #prefix: string;

  constructor(prefix = '') {
    this.#prefix = prefix;
  }

  add(code: ValidationErrorCode, path: string, message: string): void {
    this.errors.push({ code, path: `${this.#prefix}${path}`, message });
  }
}

export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/** Number of characters (code points), matching SQLite's `length()` on TEXT. */
export function characterCount(value: string): number {
  // Each surrogate pair is one character but two UTF-16 code units.
  return value.replace(SURROGATE_PAIR, '_').length;
}

const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

function matchesCalendarDate(pattern: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const match = pattern.exec(value);
  if (match === null) {
    return false;
  }
  return isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `YYYY-MM-DD` naming a real calendar date (leap years included). Pure arithmetic; no Date object. */
export function isIsoDate(value: unknown): value is string {
  return matchesCalendarDate(ISO_DATE, value);
}

/** ISO 8601 timestamp with an explicit offset, e.g. `2026-01-04T12:00:00Z`, on a real calendar date. */
export function isIsoTimestamp(value: unknown): value is string {
  return matchesCalendarDate(ISO_TIMESTAMP, value);
}

export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the entries of a plain-object record whose values are objects.
 * Reports `invalid_field` for a non-object record (returning none) and for each
 * non-object value (skipping it).
 */
export function recordEntries<V extends object>(
  record: Readonly<Record<string, V>>,
  path: string,
  errors: ErrorCollector,
): [string, V][] {
  if (!isObject(record)) {
    errors.add('invalid_field', path, `${path} must be an object keyed by id`);
    return [];
  }
  return Object.entries(record).filter(([key, value]) => {
    const ok = isObject(value);
    if (!ok) {
      errors.add('invalid_field', `${path}.${key}`, `${path}.${key} must be an object`);
    }
    return ok;
  });
}

/** Returns the items of an array, or reports `invalid_field` and returns none. */
export function arrayItems<V>(items: readonly V[], path: string, errors: ErrorCollector): readonly V[] {
  const value: unknown = items;
  if (!Array.isArray(value)) {
    errors.add('invalid_field', path, `${path} must be an array`);
    return [];
  }
  return items;
}

/**
 * Returns `[index, item]` pairs for the object items of an array. Reports
 * `invalid_field` for a non-array and for each non-object item (skipping it).
 */
export function objectItems<V extends object>(
  items: readonly V[],
  path: string,
  errors: ErrorCollector,
): [number, V][] {
  const result: [number, V][] = [];
  arrayItems(items, path, errors).forEach((item, index) => {
    if (isObject(item)) {
      result.push([index, item]);
    } else {
      errors.add('invalid_field', `${path}[${String(index)}]`, `${path}[${String(index)}] must be an object`);
    }
  });
  return result;
}

/**
 * Copies an array, mapping each item. A non-array runtime value is returned
 * unchanged so validation can report it.
 */
export function copyArray<T, U = T>(items: readonly T[], map: (item: T) => U = (item) => item as unknown as U): readonly U[] {
  const value: unknown = items;
  if (!Array.isArray(value)) {
    return items as unknown as readonly U[];
  }
  return items.map((item) => (isObject(item) ? map(item) : (item as unknown as U)));
}

/** Trims a string; leaves any other runtime value as-is so validation can report it. */
export function trimmed<T>(value: T): T {
  return (typeof value === 'string' ? value.trim() : value) as T;
}

/**
 * Validates a list of ids: each must be unique within the list and (when
 * `exists` is given) resolve, else `dangling_reference`.
 */
export function checkIdList(
  ids: readonly string[],
  path: string,
  errors: ErrorCollector,
  exists: (id: string) => boolean,
  noun: string,
): void {
  const seen = new Set<string>();
  arrayItems(ids, path, errors).forEach((id, index) => {
    const itemPath = `${path}[${String(index)}]`;
    if (!isNonEmptyString(id)) {
      errors.add('invalid_field', itemPath, `${noun} id must be a non-empty string`);
      return;
    }
    if (seen.has(id)) {
      errors.add('invalid_field', itemPath, `${noun} ${id} is listed more than once`);
      return;
    }
    seen.add(id);
    if (!exists(id)) {
      errors.add('dangling_reference', itemPath, `${noun} ${id} does not exist`);
    }
  });
}

/** True when `record` is an object with own property `key` (safe on malformed input). */
export function hasKey(record: unknown, key: unknown): boolean {
  return isObject(record) && typeof key === 'string' && Object.hasOwn(record, key);
}

/** The object stored under `key`, or undefined when absent or not an object (safe on malformed input). */
export function lookup<V extends object>(record: Readonly<Record<string, V>>, key: unknown): V | undefined {
  if (!hasKey(record, key)) {
    return undefined;
  }
  const value: unknown = record[key as string];
  return isObject(value) ? (value as V) : undefined;
}

/** Entries of a record whose values are objects; none for a malformed record. Never reports. */
export function objectEntries<V extends object>(record: Readonly<Record<string, V>>): [string, V][] {
  if (!isObject(record)) {
    return [];
  }
  return Object.entries(record).filter(([, value]) => isObject(value));
}
