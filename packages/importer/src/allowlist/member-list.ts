import type { MemberCategory, MemberGender } from '../reports/without-callings.ts';
import type { MemberListEntry, MemberListReport } from '../reports/member-list.ts';
import { AllowListError } from './import.ts';

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AllowListError('invalid_value', 'allow-list field is not a string');
  }
  return value;
}

function requireStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' || value === null) return value;
  throw new AllowListError('invalid_value', 'allow-list field is not null or a string');
}

function requireCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AllowListError('invalid_value', 'allow-list field is not a count');
  }
  return value;
}

function requireList(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new AllowListError('invalid_value', 'allow-list field is not a list');
  }
  return value;
}

function requireCategory(value: unknown): MemberCategory {
  if (value !== 'adult' && value !== 'youth') {
    throw new AllowListError('invalid_value', 'allow-list category is not adult or youth');
  }
  return value;
}

function requireGender(value: unknown): MemberGender {
  if (value !== 'M' && value !== 'F') {
    throw new AllowListError('invalid_value', 'allow-list gender is not M or F');
  }
  return value;
}

function assertKind(report: unknown, kind: string, message: string): void {
  if (field(report, 'kind') !== kind) {
    throw new AllowListError('wrong_kind', message);
  }
}

function copyEntry(raw: unknown): MemberListEntry {
  return {
    name: requireString(field(raw, 'name')),
    category: requireCategory(field(raw, 'category')),
    gender: requireGender(field(raw, 'gender')),
  };
}

export function allowListMemberList(
  input: MemberListReport,
  log?: (line: string) => void,
): MemberListReport {
  assertKind(input, 'member-list', 'member-list report has the wrong kind');
  const entries: MemberListEntry[] = [];
  for (const raw of requireList(field(input, 'entries'))) {
    entries.push(copyEntry(raw));
  }
  const report: MemberListReport = {
    kind: 'member-list',
    unitName: requireString(field(input, 'unitName')),
    reportDate: requireStringOrNull(field(input, 'reportDate')),
    listedCount: requireCount(field(input, 'listedCount')),
    excludedUnder11: requireCount(field(input, 'excludedUnder11')),
    entries,
  };
  if (log !== undefined) {
    log(`allow-list member-list entries=${String(entries.length)}`);
  }
  return report;
}
