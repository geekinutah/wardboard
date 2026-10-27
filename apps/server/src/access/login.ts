function hasControlCharOrAngleBracket(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127 || code === 60 || code === 62) {
      return true;
    }
  }
  return false;
}

/** Same acceptance rules as the Tailscale login: trim, then reject, then lowercase. */
export function normalizeLogin(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return undefined;
  if (/\s/.test(trimmed) || trimmed.includes(',') || hasControlCharOrAngleBracket(trimmed)) {
    return undefined;
  }
  return trimmed.toLowerCase();
}
