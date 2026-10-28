const importDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** UTC calendar date, or null when `importedAt` does not parse. */
export function formatImportDate(importedAt: string): string | null {
  const parsed = Date.parse(importedAt);
  if (Number.isNaN(parsed)) return null;
  return importDateFormat.format(parsed);
}
