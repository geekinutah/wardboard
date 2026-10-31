import { createHash } from 'node:crypto';
import type { ImportBundle } from '../allowlist/import.ts';
import type { OrganizationsReport } from '../reports/organizations.ts';
import type { OutOfUnitReport, OutOfUnitSection } from '../reports/out-of-unit.ts';
import type { MemberCategory, MemberGender, WithoutCallingsReport } from '../reports/without-callings.ts';

export class ReconcileError extends Error {
  readonly code: 'invalid_name';

  constructor() {
    super('reconcile name is empty');
    this.name = 'ReconcileError';
    this.code = 'invalid_name';
  }
}

export type ReportKind = 'organizations' | 'without-callings' | 'out-of-unit';

export interface ExternalCallingRef {
  readonly section: OutOfUnitSection;
  readonly calling: string;
  readonly servingUnit: string | null;
}

export type PersonDecision = {
  readonly name: string;
  readonly key: string;
  readonly category: 'adult' | 'youth' | null;
  readonly gender: MemberGender | null;
  readonly sources: readonly ReportKind[];
  readonly externalCallings: readonly ExternalCallingRef[];
} & (
  | { readonly kind: 'matched'; readonly memberId: string }
  | { readonly kind: 'new' }
  | {
      readonly kind: 'ambiguous';
      readonly reason: 'namesake' | 'resembles' | 'report_conflict';
      readonly candidates: readonly { readonly memberId: string; readonly name: string }[];
    }
);

export interface ReconcileResult {
  readonly decisions: readonly PersonDecision[];
  readonly absent: readonly { readonly memberId: string; readonly name: string }[];
  readonly duplicates: readonly ReportKind[];
  readonly inconsistentReports: boolean;
}

const REPORT_KINDS = ['organizations', 'without-callings', 'out-of-unit'] as const;

const COMMA_NAME = /^(.+?), (.+)$/;

interface NameParts {
  readonly last: string;
  readonly given: ReadonlySet<string>;
}

interface ExistingMember {
  readonly id: string;
  readonly name: string;
  readonly key: string;
}

interface PersonDraft {
  readonly name: string;
  readonly key: string;
  readonly categories: MemberCategory[];
  readonly genders: MemberGender[];
  readonly sourceSet: Set<ReportKind>;
  readonly externalCallings: ExternalCallingRef[];
}

interface MemberRef {
  readonly memberId: string;
  readonly name: string;
}

/** NFKD, strip combining marks, English lowercase, collapse whitespace, trim. Comma form is kept as-is. */
export function canonicalName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

export function reportFingerprint(
  report: OrganizationsReport | WithoutCallingsReport | OutOfUnitReport,
): string {
  return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}

function requireKey(name: string): string {
  const key = canonicalName(name);
  if (key.length === 0) {
    throw new ReconcileError();
  }
  return key;
}

function nameParts(key: string): NameParts {
  const match = COMMA_NAME.exec(key);
  const last = match?.[1];
  const givenText = match?.[2];
  if (last !== undefined && givenText !== undefined && last.length > 0 && givenText.length > 0) {
    return { last, given: new Set(givenText.split(' ')) };
  }
  const words = key.length === 0 ? [] : key.split(' ');
  return { last: words[words.length - 1] ?? '', given: new Set(words.slice(0, -1)) };
}

function resembles(left: string, right: string): boolean {
  if (left === right) {
    return false;
  }
  const a = nameParts(left);
  const b = nameParts(right);
  if (a.last !== b.last) {
    return false;
  }
  for (const token of a.given) {
    if (b.given.has(token)) {
      return true;
    }
  }
  return false;
}

function memberRef(member: ExistingMember): MemberRef {
  return { memberId: member.id, name: member.name };
}

function isReportConflict(person: PersonDraft): boolean {
  if (new Set(person.categories).size > 1) {
    return true;
  }
  if (new Set(person.genders).size > 1) {
    return true;
  }
  return person.sourceSet.has('organizations') && person.sourceSet.has('without-callings');
}

function categoryOf(person: PersonDraft): MemberCategory | null {
  if (isReportConflict(person)) {
    return null;
  }
  const categories = new Set(person.categories);
  if (categories.size !== 1) {
    return null;
  }
  const [category] = categories;
  return category ?? null;
}

/**
 * Categories from the Member List, by canonical name. A name printed more than once
 * (namesakes) maps to null: the list can't say which person is which. Children under 11
 * have no entry, so they get nothing here.
 */
function memberListCategories(imported: ImportBundle): Map<string, MemberCategory | null> {
  const byKey = new Map<string, MemberCategory | null>();
  for (const entry of imported.memberList.entries) {
    const key = canonicalName(entry.name);
    byKey.set(key, byKey.has(key) ? null : entry.category);
  }
  return byKey;
}

/**
 * Settles an unknown category from the Member List. A Members without Callings age is kept;
 * if the Member List disagrees, the category becomes null so the review asks. A report
 * conflict stays null. The Member List never changes matching.
 */
function settledCategory(person: PersonDraft, listed: ReadonlyMap<string, MemberCategory | null>): MemberCategory | null {
  const derived = categoryOf(person);
  if (isReportConflict(person)) {
    return null;
  }
  const fromList = listed.get(person.key) ?? null;
  if (fromList === null) {
    return derived;
  }
  if (derived === null) {
    return fromList;
  }
  return derived === fromList ? derived : null;
}

function memberListGenders(imported: ImportBundle): Map<string, MemberGender | null> {
  const byKey = new Map<string, MemberGender | null>();
  for (const entry of imported.memberList.entries) {
    const key = canonicalName(entry.name);
    byKey.set(key, byKey.has(key) ? null : entry.gender);
  }
  return byKey;
}

function settledGender(
  person: PersonDraft,
  listed: ReadonlyMap<string, MemberGender | null>,
): MemberGender | null {
  if (isReportConflict(person)) {
    return null;
  }
  const genders = new Set(person.genders);
  const derived = genders.size === 1 ? (person.genders[0] ?? null) : null;
  const fromList = listed.get(person.key) ?? null;
  if (fromList === null) {
    return derived;
  }
  if (derived === null) {
    return fromList;
  }
  return derived === fromList ? derived : null;
}

function sourcesOf(person: PersonDraft): ReportKind[] {
  return REPORT_KINDS.filter((kind) => person.sourceSet.has(kind));
}

function readMembers(members: readonly { readonly id: string; readonly name: string }[]): ExistingMember[] {
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    key: requireKey(member.name),
  }));
}

function readPeople(imported: ImportBundle): PersonDraft[] {
  const people: PersonDraft[] = [];
  const byKey = new Map<string, PersonDraft>();
  const add = (printed: string): PersonDraft => {
    const key = requireKey(printed);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: PersonDraft = {
      name: printed,
      key,
      categories: [],
      genders: [],
      sourceSet: new Set(),
      externalCallings: [],
    };
    byKey.set(key, created);
    people.push(created);
    return created;
  };

  for (const organization of imported.organizations.organizations) {
    for (const group of organization.groups) {
      for (const position of group.positions) {
        if (position.occupant === null) {
          continue;
        }
        add(position.occupant).sourceSet.add('organizations');
      }
    }
  }
  for (const candidate of imported.withoutCallings.candidates) {
    const person = add(candidate.name);
    person.sourceSet.add('without-callings');
    person.categories.push(candidate.category);
    person.genders.push(candidate.gender);
  }
  for (const calling of imported.outOfUnit.externalCallings) {
    const person = add(calling.name);
    person.sourceSet.add('out-of-unit');
    person.externalCallings.push({
      section: calling.section,
      calling: calling.calling,
      servingUnit: calling.servingUnit,
    });
  }
  return people;
}

function decidePerson(
  person: PersonDraft,
  members: readonly ExistingMember[],
  bundleKeys: ReadonlySet<string>,
  similarIds: Set<string>,
  listedCategories: ReadonlyMap<string, MemberCategory | null>,
  listedGenders: ReadonlyMap<string, MemberGender | null>,
): PersonDecision {
  const header = {
    name: person.name,
    key: person.key,
    category: settledCategory(person, listedCategories),
    gender: settledGender(person, listedGenders),
    sources: sourcesOf(person),
    externalCallings: person.externalCallings,
  };
  if (isReportConflict(person)) {
    return { ...header, kind: 'ambiguous', reason: 'report_conflict', candidates: [] };
  }
  const exact = members.filter((member) => member.key === person.key);
  const similar = members.filter((member) => resembles(member.key, person.key) && !bundleKeys.has(member.key));
  for (const member of similar) {
    similarIds.add(member.id);
  }
  const candidates = [...exact, ...similar].map(memberRef);
  if (exact.length >= 2) {
    return { ...header, kind: 'ambiguous', reason: 'namesake', candidates };
  }
  if (similar.length > 0) {
    return { ...header, kind: 'ambiguous', reason: 'resembles', candidates };
  }
  const only = exact[0];
  if (only !== undefined) {
    return { ...header, kind: 'matched', memberId: only.id };
  }
  return { ...header, kind: 'new' };
}

function absentMembers(
  members: readonly ExistingMember[],
  bundleKeys: ReadonlySet<string>,
  similarIds: ReadonlySet<string>,
  conflictKeys: readonly string[],
): MemberRef[] {
  return members
    .filter((member) => {
      if (bundleKeys.has(member.key) || similarIds.has(member.id)) {
        return false;
      }
      return !conflictKeys.some((conflictKey) => resembles(member.key, conflictKey));
    })
    .map(memberRef);
}

function duplicateKinds(
  imported: ImportBundle,
  previous: Readonly<Partial<Record<ReportKind, string>>> | undefined,
): ReportKind[] {
  if (previous === undefined) {
    return [];
  }
  const fingerprints: Record<ReportKind, string> = {
    organizations: reportFingerprint(imported.organizations),
    'without-callings': reportFingerprint(imported.withoutCallings),
    'out-of-unit': reportFingerprint(imported.outOfUnit),
  };
  return REPORT_KINDS.filter((kind) => {
    const prior = previous[kind];
    return prior !== undefined && prior === fingerprints[kind];
  });
}

function sameText(values: readonly string[]): boolean {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first);
}

function reportsDisagree(imported: ImportBundle): boolean {
  const units = [
    canonicalName(imported.organizations.unitName),
    canonicalName(imported.withoutCallings.unitName),
    canonicalName(imported.outOfUnit.unitName),
    // The Member List's unit counts; its date doesn't (its footer may print none).
    canonicalName(imported.memberList.unitName),
  ];
  const dates = [
    imported.organizations.reportDate,
    imported.withoutCallings.reportDate,
    imported.outOfUnit.reportDate,
  ];
  return !sameText(units) || !sameText(dates);
}

function countLine(result: ReconcileResult): string {
  let matched = 0;
  let created = 0;
  let ambiguous = 0;
  for (const decision of result.decisions) {
    if (decision.kind === 'matched') {
      matched += 1;
    } else if (decision.kind === 'new') {
      created += 1;
    } else {
      ambiguous += 1;
    }
  }
  return [
    'reconcile',
    `matched=${String(matched)}`,
    `new=${String(created)}`,
    `ambiguous=${String(ambiguous)}`,
    `absent=${String(result.absent.length)}`,
    `duplicates=${String(result.duplicates.length)}`,
  ].join(' ');
}

export function reconcile(input: {
  readonly bundle: ImportBundle;
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly previousFingerprints?: Readonly<Partial<Record<ReportKind, string>>>;
  readonly log?: (line: string) => void;
}): ReconcileResult {
  const members = readMembers(input.members);
  const people = readPeople(input.bundle);
  const bundleKeys = new Set(people.map((person) => person.key));
  const similarIds = new Set<string>();
  const listedCategories = memberListCategories(input.bundle);
  const listedGenders = memberListGenders(input.bundle);
  const decisions: PersonDecision[] = [];
  for (const person of people) {
    decisions.push(decidePerson(person, members, bundleKeys, similarIds, listedCategories, listedGenders));
  }
  const conflictKeys = people.filter(isReportConflict).map((person) => person.key);
  const result: ReconcileResult = {
    decisions,
    absent: absentMembers(members, bundleKeys, similarIds, conflictKeys),
    duplicates: duplicateKinds(input.bundle, input.previousFingerprints),
    inconsistentReports: reportsDisagree(input.bundle),
  };
  if (input.log !== undefined) {
    input.log(countLine(result));
  }
  return result;
}
