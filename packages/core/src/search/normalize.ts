/** NFKD, strip combining marks, English lowercase, collapse whitespace, trim. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}
