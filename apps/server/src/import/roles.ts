import type { CallingGroupKind, LeadershipRole } from '@wardboard/core';

/*
 * Classifies LCR calling titles and group names for slots an import creates
 * (T-107). Presidents and counselors are overview leaders; presidents,
 * counselors and secretaries carry the roles the presidency release rule uses
 * (SPEC §5). Executive secretaries and clerks support the bishopric and have
 * no role, so they are never released with the bishop.
 */

export interface AssignmentClassification {
  readonly leadershipRole: LeadershipRole | null;
  readonly prominent: boolean;
}

const NONE: AssignmentClassification = { leadershipRole: null, prominent: false };

/** Trimmed, internal whitespace collapsed, lower case. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function classifyAssignment(title: string): AssignmentClassification {
  const text = normalize(title);
  if (text === 'bishop') return { leadershipRole: 'president', prominent: true };
  if (text.includes('executive secretary') || text.includes('clerk')) return NONE;
  if (text.includes('first counselor') || text.includes('second counselor')) {
    return { leadershipRole: 'counselor', prominent: true };
  }
  if (text.endsWith('president') && !text.includes('assistant')) return { leadershipRole: 'president', prominent: true };
  if (text.endsWith('secretary')) return { leadershipRole: 'secretary', prominent: false };
  return NONE;
}

export function classifyCallingGroup(name: string): Extract<CallingGroupKind, 'bishopric' | 'presidency' | 'other'> {
  const text = normalize(name);
  if (text === 'bishopric') return 'bishopric';
  if (text.endsWith('presidency')) return 'presidency';
  return 'other';
}
