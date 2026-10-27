const META_KEYS = ['name', 'rationale'] as const;
const MAX_NAME = 80;
const MAX_RATIONALE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

/** Code points, so a surrogate pair counts as one character. */
function characters(value: string): number {
  return Array.from(value).length;
}

export function validateMeta(
  input: unknown,
): { ok: true; name: string; rationale: string | null } | { ok: false } {
  if (!isRecord(input) || !exactKeys(input, META_KEYS)) return { ok: false };
  if (typeof input.name !== 'string') return { ok: false };
  const name = input.name.trim();
  if (characters(name) < 1 || characters(name) > MAX_NAME) return { ok: false };

  if (input.rationale === null) return { ok: true, name, rationale: null };
  if (typeof input.rationale !== 'string') return { ok: false };
  const rationale = input.rationale.trim();
  if (characters(rationale) > MAX_RATIONALE) return { ok: false };
  return { ok: true, name, rationale: rationale.length === 0 ? null : rationale };
}
