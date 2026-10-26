const AVATAR_COLORS = [
  '#2F5D8A',
  '#7A5C2E',
  '#3F6E4E',
  '#7B4A6A',
  '#355C66',
  '#6B5A2F',
  '#4B4F8A',
  '#7A3E3E',
] as const;

export function displayName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

/** First letters of the first and last name parts. A single name yields one letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) return '';
  const firstLetter = first.charAt(0).toUpperCase();
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (last === undefined) return firstLetter;
  return `${firstLetter}${last.charAt(0).toUpperCase()}`;
}

export function avatarColor(name: string): string {
  const normalized = name.trim();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash + normalized.charCodeAt(index)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash] ?? '#2F5D8A';
}
