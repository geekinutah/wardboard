function describe(value: unknown): string {
  try {
    // At runtime JSON.stringify returns undefined for undefined, functions and symbols.
    const json = JSON.stringify(value) as string | undefined;
    return json ?? String(value);
  } catch {
    // Circular structures and BigInts cannot be serialized.
    return String(value);
  }
}

/**
 * Marks a branch the type checker has proven unreachable, typically the
 * `default` of an exhaustive `switch` over a discriminated union. If it is
 * reached at runtime anyway, it throws an `Error` naming the unexpected value.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${describe(value)}`);
}
