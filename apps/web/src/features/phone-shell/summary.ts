import type { NetDiff } from '@wardboard/core';

export type BoardEntry = {
  id: string;
  kind: 'current' | 'proposal';
  name: string;
  status: 'current' | 'draft' | 'accepted';
  importedAt: string | null;
  changeCount: number;
  removedCount: number;
};

const IMPORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function changeCount(diff: NetDiff): number {
  return (
    diff.callings.length +
    diff.releases.length +
    diff.addedPositions.length +
    diff.removedPositions.length
  );
}

export function headerSummary(input: {
  kind: 'current' | 'proposal';
  callings: number;
  releases: number;
  vacant: number;
}): string {
  if (input.kind === 'current') {
    return `${String(input.vacant)} vacant`;
  }
  const cWord = input.callings === 1 ? 'calling' : 'callings';
  const rWord = input.releases === 1 ? 'release' : 'releases';
  return `+${String(input.callings)} ${cWord} · \u2212${String(input.releases)} ${rWord} · ${String(input.vacant)} vacant`;
}

export function switcherSubtitle(entry: BoardEntry): string {
  if (entry.kind === 'current') {
    if (entry.importedAt !== null) {
      const date = new Date(entry.importedAt);
      if (!Number.isNaN(date.getTime())) {
        return `Read-only · imported ${IMPORT_DATE_FORMATTER.format(date)}`;
      }
    }
    return 'Read-only';
  }

  const parts: string[] = [];
  if (entry.status === 'accepted') {
    parts.push('Accepted');
  }

  if (entry.changeCount === 0) {
    parts.push('No changes');
  } else if (entry.changeCount === 1) {
    parts.push('1 change');
  } else {
    parts.push(`${String(entry.changeCount)} changes`);
  }

  if (entry.removedCount > 0) {
    if (entry.removedCount === 1) {
      parts.push('1 removed item');
    } else {
      parts.push(`${String(entry.removedCount)} removed items`);
    }
  }

  return parts.join(' · ');
}
