import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import type { PdfDocument, PdfRow } from '../src/index.ts';
import {
  categoryForAge,
  extractPdf,
  parseOrganizationsReport,
  parseOutOfUnitReport,
  parseWithoutCallingsReport,
} from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

const HEADINGS = ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number', 'Email'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MemberListRow {
  readonly page: number;
  readonly name: string;
  readonly gender: string;
  readonly age: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string;
}

interface MemberList {
  readonly doc: PdfDocument;
  readonly rows: readonly MemberListRow[];
  /** Report date from the page footer, as [year, month (1-12), day]. */
  readonly reportDate: readonly [number, number, number];
}

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function rowText(row: PdfRow): string {
  return row.items.map((item) => item.text).join(' ');
}

function isHeaderRow(row: PdfRow): boolean {
  const texts = row.items.map((item) => item.text);
  return HEADINGS.every((heading) => texts.includes(heading));
}

function parseDate(text: string): [number, number, number] {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(text);
  assert.ok(match, `not a "DD Mon YYYY" date: ${JSON.stringify(text)}`);
  const month = MONTHS.indexOf(match[2] ?? '') + 1;
  assert.ok(month > 0, `unknown month in ${JSON.stringify(text)}`);
  return [Number(match[3]), month, Number(match[1])];
}

/** Reads the Member List cells by the x-positions of each page's header row. */
function readMemberList(): MemberList {
  const doc = extractPdf(loadFixture('member-list.pdf'));
  const rows: MemberListRow[] = [];
  let reportDate: [number, number, number] | null = null;

  for (const page of doc.pages) {
    const headerIndex = page.rows.findIndex(isHeaderRow);
    assert.ok(headerIndex >= 0, `page ${String(page.pageNumber)} has no column header row`);
    const header = page.rows[headerIndex];
    assert.ok(header);
    const columns = HEADINGS.map((heading) => {
      const item = header.items.find((candidate) => candidate.text === heading);
      assert.ok(item);
      return { heading, x: item.x };
    });

    for (const row of page.rows.slice(headerIndex + 1)) {
      const text = rowText(row);
      if (text.includes('For Church Use Only')) {
        const footerDate = /(\d{1,2} [A-Z][a-z]{2} \d{4})/.exec(text);
        assert.ok(footerDate, `footer without a date: ${JSON.stringify(text)}`);
        reportDate ??= parseDate(footerDate[1] ?? '');
        continue;
      }
      if (text.startsWith('Count:')) continue;

      const cells = new Map<string, string>();
      for (const item of row.items) {
        let column = columns[0];
        for (const candidate of columns) {
          if (candidate.x <= item.x + 1) column = candidate;
        }
        assert.ok(column);
        assert.ok(!cells.has(column.heading), `two values in one ${column.heading} cell: ${text}`);
        cells.set(column.heading, item.text);
      }
      rows.push({
        page: page.pageNumber,
        name: cells.get('Name') ?? '',
        gender: cells.get('Gender') ?? '',
        age: cells.get('Age') ?? '',
        birthDate: cells.get('Birth Date') ?? '',
        phone: cells.get('Phone Number') ?? '',
        email: cells.get('Email') ?? '',
      });
    }
  }

  assert.ok(reportDate, 'no footer report date found');
  return { doc, rows, reportDate };
}

function fixturePeople(): Set<string> {
  const names = new Set<string>();
  const organizations = parseOrganizationsReport(extractPdf(loadFixture('organizations-and-callings.pdf')));
  for (const organization of organizations.organizations) {
    for (const group of organization.groups) {
      for (const position of group.positions) {
        if (position.occupant !== null) names.add(position.occupant);
      }
    }
  }
  const withoutCallings = parseWithoutCallingsReport(extractPdf(loadFixture('members-without-callings.pdf')));
  for (const candidate of withoutCallings.candidates) names.add(candidate.name);
  const outOfUnit = parseOutOfUnitReport(extractPdf(loadFixture('out-of-unit-callings.pdf')));
  for (const record of outOfUnit.externalCallings) names.add(record.name);
  return names;
}

function ageOn(birth: readonly [number, number, number], on: readonly [number, number, number]): number {
  const [by, bm, bd] = birth;
  const [y, m, d] = on;
  const beforeBirthday = m < bm || (m === bm && d < bd);
  return y - by - (beforeBirthday ? 1 : 0);
}

describe('T-113: Member List fixture', () => {
  it('the member list fixture is readable', () => {
    const doc = extractPdf(loadFixture('member-list.pdf'));
    const page = doc.pages[0];
    assert.ok(page, 'no pages');
    const texts = page.items.map((item) => item.text);
    assert.ok(texts.includes('Member List'), 'page 1 has no "Member List" title');
    assert.ok(texts.includes('Cedar 14th Ward (100001)'), 'page 1 has no unit line');
    const header = page.rows.find(isHeaderRow);
    assert.ok(header, 'page 1 has no column header row');
    assert.deepEqual(
      header.items.map((item) => item.text),
      [...HEADINGS],
    );
  });

  it('every fixture person appears exactly once', () => {
    const { rows } = readMemberList();
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

    const people = fixturePeople();
    assert.ok(people.size > 200, `expected the fixtures to name over 200 people, got ${String(people.size)}`);
    const wrong = [...people]
      .filter((name) => counts.get(name) !== 1)
      .map((name) => `${name}: ${String(counts.get(name) ?? 0)}`);
    assert.deepEqual(wrong, [], 'fixture people missing from or repeated in the Member List');
  });

  it('ages agree with members without callings', () => {
    const { rows } = readMemberList();
    const byName = new Map(rows.map((row) => [row.name, row]));
    const report = parseWithoutCallingsReport(extractPdf(loadFixture('members-without-callings.pdf')));
    assert.ok(report.candidates.length > 0);
    const wrong: string[] = [];
    for (const candidate of report.candidates) {
      const row = byName.get(candidate.name);
      const category = row ? categoryForAge(Number(row.age)) : 'missing';
      if (category !== candidate.category) wrong.push(`${candidate.name}: ${candidate.category} vs ${category}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('birth dates agree with ages', () => {
    const { rows, reportDate } = readMemberList();
    assert.ok(rows.length > 0);
    const wrong: string[] = [];
    for (const row of rows) {
      assert.match(row.age, /^\d{1,3}$/, `bad age for ${row.name}`);
      assert.match(row.birthDate, /^\d{2} [A-Z][a-z]{2} \d{4}$/, `bad birth date for ${row.name}`);
      const computed = ageOn(parseDate(row.birthDate), reportDate);
      if (computed !== Number(row.age)) wrong.push(`${row.name}: age ${row.age}, born ${row.birthDate}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('contact details are fictional', () => {
    const { doc, rows } = readMemberList();
    assert.ok(rows.length > 0);
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const row of rows) {
      if (row.phone !== '') {
        assert.match(row.phone, /^\(\d{3}\) 555-\d{4}$/, `non-fictional phone for ${row.name}`);
        phones.add(row.phone);
      }
      if (row.email !== '') {
        assert.match(row.email, /^[^@\s]+@example\.com$/, `non-fictional email for ${row.name}`);
        emails.add(row.email);
      }
    }
    assert.ok(phones.size > 0 && emails.size > 0, 'expected some phone and email cells');

    for (const page of doc.pages) {
      for (const item of page.items) {
        if (emails.has(item.text) || phones.has(item.text)) continue;
        assert.ok(!item.text.includes('@'), `email-like text outside the Email column: ${item.text}`);
        assert.ok(
          !/\d{3}\D{0,2}\d{3}\D?\d{4}|\d{3}-\d{4}/.test(item.text),
          `phone-like text outside the Phone Number column: ${item.text}`,
        );
      }
    }
  });
});
