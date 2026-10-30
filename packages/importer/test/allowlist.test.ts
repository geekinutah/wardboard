import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  AllowListError,
  allowListImport,
  extractPdf,
  importReports,
  OrganizationsReportError,
  type PdfDocument,
  type PdfTextItem,
} from '../src/index.ts';

const CANARIES = [
  'CANARY-MRN-998877665',
  'CANARY-PHONE-555-0199',
  'CANARY-DOB-1974-01-31',
  'CANARY-ADDR-1-SECRET-LANE',
  'canary.email@example.invalid',
] as const;

const PHONE_RE = /\b\d{3}-\d{4}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PRINTED_DATE_RE = /^\d{1,2} [A-Za-z]{3,9} \d{4}$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function loadDocs(): {
  organizations: PdfDocument;
  withoutCallings: PdfDocument;
  outOfUnit: PdfDocument;
  memberList: PdfDocument;
} {
  return {
    organizations: extractPdf(loadFixture('organizations-and-callings.pdf')),
    withoutCallings: extractPdf(loadFixture('members-without-callings.pdf')),
    outOfUnit: extractPdf(loadFixture('out-of-unit-callings.pdf')),
    memberList: extractPdf(loadFixture('member-list.pdf')),
  };
}

const fixtureDocs = loadDocs();

interface Position {
  title: string;
  custom: boolean;
  occupant: string | null;
}

interface Group {
  name: string;
  positions: Position[];
}

interface Organization {
  name: string;
  groups: Group[];
}

interface OrganizationsReportInput {
  kind: 'organizations';
  unitName: string;
  reportDate: string;
  organizations: Organization[];
}

interface Candidate {
  name: string;
  category: 'adult' | 'youth';
}

interface WithoutCallingsReportInput {
  kind: 'without-callings';
  unitName: string;
  reportDate: string;
  listedCount: number;
  excludedUnder11: number;
  candidates: Candidate[];
}

interface ExternalCalling {
  section: 'stake' | 'serving-outside-unit' | 'living-outside-unit';
  name: string;
  calling: string;
  servingUnit: string | null;
}

interface OutOfUnitReportInput {
  kind: 'out-of-unit';
  unitName: string;
  reportDate: string;
  externalCallings: ExternalCalling[];
}

interface ValidInput {
  organizations: OrganizationsReportInput;
  withoutCallings: WithoutCallingsReportInput;
  outOfUnit: OutOfUnitReportInput;
  position: Position;
  group: Group;
  organization: Organization;
  candidate: Candidate;
  externalCalling: ExternalCalling;
}

function validInput(): ValidInput {
  const position: Position = { title: 'Bishop', custom: true, occupant: null };
  const group: Group = { name: 'Bishopric', positions: [position] };
  const organization: Organization = { name: 'Bishopric', groups: [group] };
  const organizations: OrganizationsReportInput = {
    kind: 'organizations',
    unitName: 'Cedar 14th Ward',
    reportDate: '2026-10-25',
    organizations: [organization],
  };
  const candidate: Candidate = { name: 'Kelley, Kaia', category: 'adult' };
  const withoutCallings: WithoutCallingsReportInput = {
    kind: 'without-callings',
    unitName: 'Cedar 14th Ward',
    reportDate: '2026-10-25',
    listedCount: 1,
    excludedUnder11: 0,
    candidates: [candidate],
  };
  const externalCalling: ExternalCalling = {
    section: 'stake',
    name: 'Melford, Leo',
    calling: 'Stake Sports Specialist',
    servingUnit: null,
  };
  const outOfUnit: OutOfUnitReportInput = {
    kind: 'out-of-unit',
    unitName: 'Cedar 14th Ward',
    reportDate: '2026-10-25',
    externalCallings: [externalCalling],
  };
  return {
    organizations,
    withoutCallings,
    outOfUnit,
    position,
    group,
    organization,
    candidate,
    externalCalling,
  };
}

function bundleOf(input: ValidInput): Parameters<typeof allowListImport>[0] {
  return {
    organizations: input.organizations,
    withoutCallings: input.withoutCallings,
    outOfUnit: input.outOfUnit,
    memberList: {
      kind: 'member-list',
      unitName: 'Cedar 14th Ward',
      reportDate: '2026-10-25',
      listedCount: 0,
      excludedUnder11: 0,
      entries: [],
    },
  };
}

function plantCanaries(target: object): void {
  const record = target as Record<string, string>;
  for (const canary of CANARIES) {
    record[canary] = canary;
  }
}

function echoingValue(): { toString(): string; leaked: string } {
  return {
    toString() {
      return 'CANARY-MRN-998877665';
    },
    leaked: 'CANARY-PHONE-555-0199',
  };
}

function assertAllowListError(
  input: Parameters<typeof allowListImport>[0],
  code: 'wrong_kind' | 'invalid_value',
  message: string,
): void {
  const logs: string[] = [];
  assert.throws(
    () => {
      allowListImport(input, (line) => {
        logs.push(line);
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AllowListError);
      assert.equal(err.code, code);
      assert.equal(err.message, message);
      assert.equal(err.message.includes('CANARY'), false);
      return true;
    },
  );
  assert.deepEqual(logs, []);
}

function textItems(doc: PdfDocument): string[] {
  const texts: string[] = [];
  for (const page of doc.pages) {
    for (const item of page.items) {
      texts.push(item.text);
    }
  }
  return texts;
}

function collectMatches(texts: readonly string[], pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (value) {
        found.add(value);
      }
    }
  }
  return found;
}

function printedDates(doc: PdfDocument): string[] {
  return textItems(doc).filter((text) => PRINTED_DATE_RE.test(text));
}

function positionCount(report: {
  organizations: readonly { groups: readonly { positions: readonly unknown[] }[] }[];
}): number {
  let count = 0;
  for (const organization of report.organizations) {
    for (const group of organization.groups) {
      count += group.positions.length;
    }
  }
  return count;
}

describe('T-056: allow-list and leakage checks', () => {
  it('drops extra keys and canary values at every level', () => {
    const input = validInput();
    const inherited = { inherited: CANARIES[0] };
    Object.setPrototypeOf(input.organizations, inherited);
    Object.defineProperty(input.position, 'hidden', {
      value: CANARIES[1],
      enumerable: false,
    });
    plantCanaries(input.organizations);
    plantCanaries(input.withoutCallings);
    plantCanaries(input.outOfUnit);
    plantCanaries(input.organization);
    plantCanaries(input.group);
    plantCanaries(input.position);
    plantCanaries(input.candidate);
    plantCanaries(input.externalCalling);

    const logs: string[] = [];
    const bundle = allowListImport(bundleOf(input), (line) => {
      logs.push(line);
    });
    const json = JSON.stringify(bundle);

    for (const canary of CANARIES) {
      assert.equal(json.includes(canary), false, canary);
    }
    assert.deepEqual(logs, ['allow-list organizations=1 candidates=1 external=1']);
    const logLine = logs[0];
    assert.ok(logLine);
    for (const canary of CANARIES) {
      assert.equal(logLine.includes(canary), false, canary);
    }

    assert.deepEqual(Object.keys(bundle.organizations), ['kind', 'unitName', 'reportDate', 'organizations']);
    const organization = bundle.organizations.organizations[0];
    assert.ok(organization);
    assert.deepEqual(Object.keys(organization), ['name', 'groups']);
    const group = organization.groups[0];
    assert.ok(group);
    assert.deepEqual(Object.keys(group), ['name', 'positions']);
    const position = group.positions[0];
    assert.ok(position);
    assert.deepEqual(Object.keys(position), ['title', 'custom', 'occupant']);
    assert.deepEqual(Object.keys(bundle.withoutCallings), [
      'kind',
      'unitName',
      'reportDate',
      'listedCount',
      'excludedUnder11',
      'candidates',
    ]);
    const candidate = bundle.withoutCallings.candidates[0];
    assert.ok(candidate);
    assert.deepEqual(Object.keys(candidate), ['name', 'category']);
    assert.deepEqual(Object.keys(bundle.outOfUnit), ['kind', 'unitName', 'reportDate', 'externalCallings']);
    const externalCalling = bundle.outOfUnit.externalCallings[0];
    assert.ok(externalCalling);
    assert.deepEqual(Object.keys(externalCalling), ['section', 'name', 'calling', 'servingUnit']);

    assert.equal(Object.getPrototypeOf(bundle.organizations), Object.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(position, 'hidden'), undefined);
    assert.equal(bundle.organizations.unitName, 'Cedar 14th Ward');
    assert.equal(bundle.organizations.reportDate, '2026-10-25');
    assert.equal(position.title, 'Bishop');
    assert.equal(position.custom, true);
    assert.equal(position.occupant, null);
    assert.equal(bundle.withoutCallings.listedCount, 1);
    assert.equal(bundle.withoutCallings.excludedUnder11, 0);
    assert.deepEqual(candidate, { name: 'Kelley, Kaia', category: 'adult' });
    assert.equal(externalCalling.servingUnit, null);
  });

  it('does not share nested objects with the input', () => {
    const input = validInput();
    const bundle = allowListImport(bundleOf(input));
    input.position.title = 'Changed title';
    const copied = bundle.organizations.organizations[0]?.groups[0]?.positions[0];
    assert.ok(copied);
    assert.equal(copied.title, 'Bishop');
    assert.notEqual(copied, input.position);
    assert.notEqual(bundle.organizations, input.organizations);
    assert.notEqual(bundle.organizations.organizations, input.organizations.organizations);
    assert.notEqual(bundle.organizations.organizations[0], input.organization);
    assert.notEqual(bundle.organizations.organizations[0]?.groups, input.organization.groups);
    assert.notEqual(bundle.organizations.organizations[0]?.groups[0], input.group);
    assert.notEqual(bundle.organizations.organizations[0]?.groups[0]?.positions, input.group.positions);
    assert.notEqual(bundle.withoutCallings, input.withoutCallings);
    assert.notEqual(bundle.withoutCallings.candidates, input.withoutCallings.candidates);
    assert.notEqual(bundle.withoutCallings.candidates[0], input.candidate);
    assert.notEqual(bundle.outOfUnit, input.outOfUnit);
    assert.notEqual(bundle.outOfUnit.externalCallings, input.outOfUnit.externalCallings);
    assert.notEqual(bundle.outOfUnit.externalCallings[0], input.externalCalling);
  });

  it('rejects a bad kind, category, section, and non-string without echoing the value', () => {
    const wrongOrganizations = validInput();
    (wrongOrganizations.organizations as { kind: string }).kind = CANARIES[0];
    (wrongOrganizations.organizations as { unitName: unknown }).unitName = echoingValue();
    assertAllowListError(bundleOf(wrongOrganizations), 'wrong_kind', 'organizations report has the wrong kind');

    const allWrong = validInput();
    (allWrong.organizations as { kind: string }).kind = CANARIES[1];
    (allWrong.withoutCallings as { kind: string }).kind = CANARIES[2];
    (allWrong.outOfUnit as { kind: string }).kind = CANARIES[3];
    assertAllowListError(bundleOf(allWrong), 'wrong_kind', 'organizations report has the wrong kind');

    const wrongWithout = validInput();
    (wrongWithout.withoutCallings as { kind: string }).kind = CANARIES[2];
    assertAllowListError(bundleOf(wrongWithout), 'wrong_kind', 'without-callings report has the wrong kind');

    const wrongOut = validInput();
    (wrongOut.outOfUnit as { kind: string }).kind = CANARIES[3];
    assertAllowListError(bundleOf(wrongOut), 'wrong_kind', 'out-of-unit report has the wrong kind');

    const badCategory = validInput();
    (badCategory.candidate as { category: string }).category = CANARIES[2];
    assertAllowListError(bundleOf(badCategory), 'invalid_value', 'allow-list category is not adult or youth');

    const badSection = validInput();
    (badSection.externalCalling as { section: string }).section = CANARIES[3];
    assertAllowListError(bundleOf(badSection), 'invalid_value', 'allow-list section is not a known section');

    const badUnitName = validInput();
    (badUnitName.organizations as { unitName: unknown }).unitName = echoingValue();
    assertAllowListError(bundleOf(badUnitName), 'invalid_value', 'allow-list field is not a string');

    const badReportDate = validInput();
    (badReportDate.withoutCallings as { reportDate: unknown }).reportDate = echoingValue();
    assertAllowListError(bundleOf(badReportDate), 'invalid_value', 'allow-list field is not a string');

    const badName = validInput();
    (badName.candidate as { name: unknown }).name = echoingValue();
    assertAllowListError(bundleOf(badName), 'invalid_value', 'allow-list field is not a string');

    const badTitle = validInput();
    (badTitle.position as { title: unknown }).title = echoingValue();
    assertAllowListError(bundleOf(badTitle), 'invalid_value', 'allow-list field is not a string');

    const badCalling = validInput();
    (badCalling.externalCalling as { calling: unknown }).calling = echoingValue();
    assertAllowListError(bundleOf(badCalling), 'invalid_value', 'allow-list field is not a string');

    const badOccupant = validInput();
    (badOccupant.position as { occupant: unknown }).occupant = echoingValue();
    assertAllowListError(bundleOf(badOccupant), 'invalid_value', 'allow-list field is not null or a string');

    const badServingUnit = validInput();
    (badServingUnit.externalCalling as { servingUnit: unknown }).servingUnit = echoingValue();
    assertAllowListError(
      bundleOf(badServingUnit),
      'invalid_value',
      'allow-list field is not null or a string',
    );

    const badCustom = validInput();
    (badCustom.position as { custom: unknown }).custom = CANARIES[4];
    assertAllowListError(bundleOf(badCustom), 'invalid_value', 'allow-list field is not a boolean');

    const badCount = validInput();
    (badCount.withoutCallings as { listedCount: unknown }).listedCount = CANARIES[0];
    assertAllowListError(bundleOf(badCount), 'invalid_value', 'allow-list field is not a count');

    const negativeCount = validInput();
    negativeCount.withoutCallings.excludedUnder11 = -1;
    assertAllowListError(bundleOf(negativeCount), 'invalid_value', 'allow-list field is not a count');

    const fractionalCount = validInput();
    fractionalCount.withoutCallings.listedCount = 1.5;
    assertAllowListError(bundleOf(fractionalCount), 'invalid_value', 'allow-list field is not a count');

    const badOrganizations = validInput();
    (badOrganizations.organizations as { organizations: unknown }).organizations = CANARIES[4];
    assertAllowListError(bundleOf(badOrganizations), 'invalid_value', 'allow-list field is not a list');

    const badGroups = validInput();
    (badGroups.organization as { groups: unknown }).groups = CANARIES[4];
    assertAllowListError(bundleOf(badGroups), 'invalid_value', 'allow-list field is not a list');

    const badPositions = validInput();
    (badPositions.group as { positions: unknown }).positions = CANARIES[4];
    assertAllowListError(bundleOf(badPositions), 'invalid_value', 'allow-list field is not a list');

    const badCandidates = validInput();
    (badCandidates.withoutCallings as { candidates: unknown }).candidates = CANARIES[4];
    assertAllowListError(bundleOf(badCandidates), 'invalid_value', 'allow-list field is not a list');

    const badExternal = validInput();
    (badExternal.outOfUnit as { externalCallings: unknown }).externalCallings = CANARIES[4];
    assertAllowListError(bundleOf(badExternal), 'invalid_value', 'allow-list field is not a list');
  });

  it('importReports matches the fictional fixtures and keeps allowed data', () => {
    const logs: string[] = [];
    const bundle = importReports(fixtureDocs, (line) => {
      logs.push(line);
    });

    assert.equal(bundle.organizations.unitName, 'Cedar 14th Ward');
    assert.equal(bundle.withoutCallings.unitName, 'Cedar 14th Ward');
    assert.equal(bundle.outOfUnit.unitName, 'Cedar 14th Ward');
    assert.equal(bundle.organizations.reportDate, '2026-10-25');
    assert.equal(bundle.withoutCallings.reportDate, '2026-10-25');
    assert.equal(bundle.outOfUnit.reportDate, '2026-10-25');
    assert.equal(bundle.organizations.organizations.length, 11);
    assert.equal(positionCount(bundle.organizations), 244);
    assert.equal(bundle.withoutCallings.listedCount, 145);
    assert.equal(bundle.withoutCallings.candidates.length, 112);
    assert.equal(bundle.withoutCallings.excludedUnder11, 33);
    assert.equal(bundle.outOfUnit.externalCallings.length, 37);

    const bishop = bundle.organizations.organizations[0]?.groups[0]?.positions[0];
    assert.deepEqual(bishop, { title: 'Bishop', custom: false, occupant: 'Stanley, Zed' });
    const vacant = bundle.organizations.organizations[0]?.groups[0]?.positions[5];
    assert.deepEqual(vacant, {
      title: 'Ward Assistant Executive Secretary',
      custom: false,
      occupant: null,
    });
    assert.deepEqual(bundle.withoutCallings.candidates[0], { name: 'Kelley, Kaia', category: 'adult' });
    assert.deepEqual(bundle.outOfUnit.externalCallings[0], {
      section: 'stake',
      name: 'Melford, Leo',
      calling: 'Stake Sports Specialist',
      servingUnit: null,
    });

    const json = JSON.stringify(bundle);
    assert.equal(json.includes('100001'), false);
    assert.equal(json.includes('200002'), false);
    assert.deepEqual(logs, ['allow-list organizations=244 candidates=112 external=37']);
  });

  it('real fixture phones, emails, and printed dates do not survive', () => {
    const withoutTexts = textItems(fixtureDocs.withoutCallings);
    const organizationTexts = textItems(fixtureDocs.organizations);
    const outTexts = textItems(fixtureDocs.outOfUnit);
    const rawTexts = [...withoutTexts, ...organizationTexts, ...outTexts];
    const phones = collectMatches(rawTexts, PHONE_RE);
    const withoutPhones = collectMatches(withoutTexts, PHONE_RE);
    const emails = collectMatches(rawTexts, EMAIL_RE);
    const withoutEmails = collectMatches(withoutTexts, EMAIL_RE);
    const printed = [
      ...printedDates(fixtureDocs.organizations),
      ...printedDates(fixtureDocs.withoutCallings),
      ...printedDates(fixtureDocs.outOfUnit),
    ];

    assert.ok(phones.size > withoutPhones.size);
    assert.equal(phones.has('555-0100'), true);
    assert.equal(withoutPhones.has('555-0100'), false);
    assert.ok(emails.size >= 1);
    assert.equal(withoutEmails.size, 0);
    assert.ok(printed.length >= 1);
    assert.equal(withoutTexts.join('\n').includes('1 Jan 2026'), true);
    assert.equal(outTexts.join('\n').includes('1 Jan 2026'), false);

    const logs: string[] = [];
    const bundle = importReports(fixtureDocs, (line) => {
      logs.push(line);
    });
    const json = JSON.stringify(bundle);
    const logText = logs.join('\n');

    for (const phone of phones) {
      assert.equal(json.includes(phone), false, phone);
      assert.equal(logText.includes(phone), false, phone);
    }
    for (const email of emails) {
      assert.equal(json.includes(email), false, email);
      assert.equal(logText.includes(email), false, email);
    }
    for (const date of printed) {
      assert.equal(json.includes(date), false, date);
      assert.equal(logText.includes(date), false, date);
    }
  });

  it('extra cells on a member row do not enter the bundle or the log', () => {
    const withoutCallings = structuredClone(fixtureDocs.withoutCallings);
    const page = withoutCallings.pages[0];
    assert.ok(page);
    const headerIdx = page.rows.findIndex(
      (row) =>
        row.items.some((item) => item.text === 'Name') &&
        row.items.some((item) => item.text === 'Gender') &&
        row.items.some((item) => item.text === 'Age') &&
        row.items.some((item) => item.text === 'Birth Date'),
    );
    assert.ok(headerIdx >= 0);
    const memberRow = page.rows[headerIdx + 1];
    assert.ok(memberRow);
    assert.equal(memberRow.items[0]?.text, 'Kelley, Kaia');
    const sample: PdfTextItem | undefined = memberRow.items[0];
    assert.ok(sample);
    const items: PdfTextItem[] = [
      ...memberRow.items,
      ...CANARIES.map((text) => ({
        text,
        x: 2000,
        y: memberRow.y,
        fontSize: sample.fontSize,
        fontName: sample.fontName,
        bold: false,
        italic: false,
      })),
    ];
    (memberRow as unknown as { items: PdfTextItem[] }).items = items;

    const logs: string[] = [];
    const bundle = importReports(
      {
        organizations: fixtureDocs.organizations,
        withoutCallings,
        outOfUnit: fixtureDocs.outOfUnit,
        memberList: fixtureDocs.memberList,
      },
      (line) => {
        logs.push(line);
      },
    );

    assert.equal(bundle.withoutCallings.candidates.length, 112);
    assert.deepEqual(logs, ['allow-list organizations=244 candidates=112 external=37']);
    const json = JSON.stringify(bundle);
    const logLine = logs[0];
    assert.ok(logLine);
    for (const canary of CANARIES) {
      assert.equal(json.includes(canary), false, canary);
      assert.equal(logLine.includes(canary), false, canary);
    }
  });

  it('a parser error does not log', () => {
    const logs: string[] = [];
    const organizations: PdfDocument = { ...fixtureDocs.organizations, title: 'Not a report' };
    assert.throws(
      () => {
        importReports(
          {
            organizations,
            withoutCallings: fixtureDocs.withoutCallings,
            outOfUnit: fixtureDocs.outOfUnit,
            memberList: fixtureDocs.memberList,
          },
          (line) => {
            logs.push(line);
          },
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'WRONG_REPORT');
        return true;
      },
    );
    assert.deepEqual(logs, []);
  });

  it('is deterministic and does not use the console', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => vi.spyOn(console, method));
    try {
      const first = importReports(fixtureDocs);
      const second = importReports(fixtureDocs);
      expect(first).toStrictEqual(second);
      for (const spy of spies) {
        assert.equal(spy.mock.calls.length, 0);
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
