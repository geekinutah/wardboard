/**
 * Recursively freezes a plain-data value (objects and arrays) and returns it.
 * Constructors build fresh copies and freeze them, so accidental mutation of a
 * constructed value throws in strict mode.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
