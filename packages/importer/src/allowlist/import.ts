import type { PdfDocument } from '../pdf/index.ts';
import {
  parseOrganizationsReport,
  type OrganizationsReport,
  type ReportGroup,
  type ReportOrganization,
  type ReportPosition,
} from '../reports/organizations.ts';
import {
  parseOutOfUnitReport,
  type ExternalCallingRecord,
  type OutOfUnitReport,
  type OutOfUnitSection,
} from '../reports/out-of-unit.ts';
import {
  parseWithoutCallingsReport,
  type MemberCategory,
  type MemberGender,
  type WithoutCallingsCandidate,
  type WithoutCallingsReport,
} from '../reports/without-callings.ts';
import { parseMemberList, type MemberListReport } from '../reports/member-list.ts';
import { allowListMemberList } from './member-list.ts';

export class AllowListError extends Error {
  readonly code: 'wrong_kind' | 'invalid_value';

  constructor(code: 'wrong_kind' | 'invalid_value', message: string) {
    super(message);
    this.name = 'AllowListError';
    this.code = code;
  }
}

export interface ImportBundle {
  readonly organizations: OrganizationsReport;
  readonly withoutCallings: WithoutCallingsReport;
  readonly outOfUnit: OutOfUnitReport;
  /** Name and youth/adult only (SPEC §15). Never adds people; it only settles categories. */
  readonly memberList: MemberListReport;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AllowListError('invalid_value', 'allow-list field is not a string');
  }
  return value;
}

function requireStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return null;
  }
  throw new AllowListError('invalid_value', 'allow-list field is not null or a string');
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new AllowListError('invalid_value', 'allow-list field is not a boolean');
  }
  return value;
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

function requireSection(value: unknown): OutOfUnitSection {
  if (value !== 'stake' && value !== 'serving-outside-unit' && value !== 'living-outside-unit') {
    throw new AllowListError('invalid_value', 'allow-list section is not a known section');
  }
  return value;
}

function mapList<T>(value: unknown, copy: (item: unknown) => T): T[] {
  const copied: T[] = [];
  for (const item of requireList(value)) {
    copied.push(copy(item));
  }
  return copied;
}

function assertKind(report: unknown, kind: string, message: string): void {
  if (field(report, 'kind') !== kind) {
    throw new AllowListError('wrong_kind', message);
  }
}

function copyPosition(raw: unknown): ReportPosition {
  return {
    title: requireString(field(raw, 'title')),
    custom: requireBoolean(field(raw, 'custom')),
    occupant: requireStringOrNull(field(raw, 'occupant')),
  };
}

function copyGroup(raw: unknown): ReportGroup {
  return {
    name: requireString(field(raw, 'name')),
    positions: mapList(field(raw, 'positions'), copyPosition),
  };
}

function copyOrganization(raw: unknown): ReportOrganization {
  return {
    name: requireString(field(raw, 'name')),
    groups: mapList(field(raw, 'groups'), copyGroup),
  };
}

function copyOrganizationsReport(raw: unknown): OrganizationsReport {
  return {
    kind: 'organizations',
    unitName: requireString(field(raw, 'unitName')),
    reportDate: requireString(field(raw, 'reportDate')),
    organizations: mapList(field(raw, 'organizations'), copyOrganization),
  };
}

function copyCandidate(raw: unknown): WithoutCallingsCandidate {
  return {
    name: requireString(field(raw, 'name')),
    category: requireCategory(field(raw, 'category')),
    gender: requireGender(field(raw, 'gender')),
  };
}

function copyWithoutCallingsReport(raw: unknown): WithoutCallingsReport {
  return {
    kind: 'without-callings',
    unitName: requireString(field(raw, 'unitName')),
    reportDate: requireString(field(raw, 'reportDate')),
    listedCount: requireCount(field(raw, 'listedCount')),
    excludedUnder11: requireCount(field(raw, 'excludedUnder11')),
    candidates: mapList(field(raw, 'candidates'), copyCandidate),
  };
}

function copyExternalCalling(raw: unknown): ExternalCallingRecord {
  return {
    section: requireSection(field(raw, 'section')),
    name: requireString(field(raw, 'name')),
    calling: requireString(field(raw, 'calling')),
    servingUnit: requireStringOrNull(field(raw, 'servingUnit')),
  };
}

function copyOutOfUnitReport(raw: unknown): OutOfUnitReport {
  return {
    kind: 'out-of-unit',
    unitName: requireString(field(raw, 'unitName')),
    reportDate: requireString(field(raw, 'reportDate')),
    externalCallings: mapList(field(raw, 'externalCallings'), copyExternalCalling),
  };
}

function countPositions(report: OrganizationsReport): number {
  let count = 0;
  for (const organization of report.organizations) {
    for (const group of organization.groups) {
      count += group.positions.length;
    }
  }
  return count;
}

export function allowListImport(
  input: {
    readonly organizations: OrganizationsReport;
    readonly withoutCallings: WithoutCallingsReport;
    readonly outOfUnit: OutOfUnitReport;
    readonly memberList: MemberListReport;
  },
  log?: (line: string) => void,
): ImportBundle {
  assertKind(input.organizations, 'organizations', 'organizations report has the wrong kind');
  assertKind(input.withoutCallings, 'without-callings', 'without-callings report has the wrong kind');
  assertKind(input.outOfUnit, 'out-of-unit', 'out-of-unit report has the wrong kind');

  const organizations = copyOrganizationsReport(input.organizations);
  const withoutCallings = copyWithoutCallingsReport(input.withoutCallings);
  const outOfUnit = copyOutOfUnitReport(input.outOfUnit);
  // No log callback: the existing allow-list line stays the only one.
  const memberList = allowListMemberList(input.memberList);

  if (log !== undefined) {
    log(
      `allow-list organizations=${String(countPositions(organizations))} candidates=${String(withoutCallings.candidates.length)} external=${String(outOfUnit.externalCallings.length)}`,
    );
  }

  return { organizations, withoutCallings, outOfUnit, memberList };
}

export function importReports(
  docs: {
    readonly organizations: PdfDocument;
    readonly withoutCallings: PdfDocument;
    readonly outOfUnit: PdfDocument;
    readonly memberList: PdfDocument;
  },
  log?: (line: string) => void,
): ImportBundle {
  const organizations = parseOrganizationsReport(docs.organizations);
  const withoutCallings = parseWithoutCallingsReport(docs.withoutCallings);
  const outOfUnit = parseOutOfUnitReport(docs.outOfUnit);
  const memberList = parseMemberList(docs.memberList);
  if (log === undefined) {
    return allowListImport({ organizations, withoutCallings, outOfUnit, memberList });
  }
  return allowListImport({ organizations, withoutCallings, outOfUnit, memberList }, log);
}
