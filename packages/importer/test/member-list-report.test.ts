import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import type { PdfDocument, PdfPage, PdfRow, PdfTextItem } from '../src/index.ts';
import { extractPdf, MemberListReportError, parseMemberList } from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

const HEADINGS = ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number', 'Email'] as const;
const OTHER_REPORTS = [
  'organizations-and-callings.pdf',
  'members-without-callings.pdf',
  'out-of-unit-callings.pdf',
] as const;

const COLUMN_X = {
  name: 24,
  gender: 182.4,
  age: 225.6,
  birth: 261.6,
  phone: 340.8,
  email: 441.6,
} as const;

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function isHeader(row: PdfRow): boolean {
  return HEADINGS.every((heading, index) => row.items[index]?.text === heading);
}

interface FixtureRow {
  readonly name: string;
  readonly age: string;
  readonly gender: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string;
}

/** Reads member rows by header x-positions. Independent of parseMemberList. */
function fixtureRows(doc: PdfDocument): FixtureRow[] {
  const rows: FixtureRow[] = [];
  for (const page of doc.pages) {
    const header = page.rows.find(isHeader);
    assert.ok(header, `page ${String(page.pageNumber)} has no column header`);
    const columns = HEADINGS.map((heading) => {
      const found = header.items.find((item) => item.text === heading);
      assert.ok(found, heading);
      return { heading, x: found.x };
    });
    for (const row of page.rows) {
      if (row.y <= header.y) continue;
      const text = row.items.map((item) => item.text).join(' ');
      if (text.includes('For Church Use Only') || text.startsWith('Count:')) continue;
      const cells = new Map<string, string>();
      for (const item of row.items) {
        let column = columns[0];
        assert.ok(column);
        for (const candidate of columns) {
          if (candidate.x <= item.x + 1) column = candidate;
        }
        const previous = cells.get(column.heading);
        cells.set(column.heading, previous === undefined ? item.text : `${previous} ${item.text}`);
      }
      rows.push({
        name: cells.get('Name') ?? '',
        age: cells.get('Age') ?? '',
        gender: cells.get('Gender') ?? '',
        birthDate: cells.get('Birth Date') ?? '',
        phone: cells.get('Phone Number') ?? '',
        email: cells.get('Email') ?? '',
      });
    }
  }
  return rows;
}

function nameCounts(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function textItem(text: string, x: number, y: number, bold = false): PdfTextItem {
  return {
    text,
    x,
    y,
    fontSize: bold ? 10 : 8,
    fontName: bold ? 'Helvetica-Bold' : 'Helvetica',
    bold,
    italic: false,
  };
}

function rowOf(y: number, items: readonly PdfTextItem[]): PdfRow {
  return { y, items };
}

/**
 * A one-page Member List. `name` may be several name-column cells, which is how a
 * wrapped name arrives when the extractor has not already joined it.
 */
function builtMemberList(
  members: readonly { readonly name: string | readonly string[]; readonly gender: string; readonly age: string }[],
  count: number,
): PdfDocument {
  const title = textItem('Member List', 42, 63, true);
  const unit = textItem('Cedar 14th Ward (100001)', 42, 75);
  const headerY = 98;
  const header = [
    textItem('Name', COLUMN_X.name, headerY, true),
    textItem('Gender', COLUMN_X.gender, headerY, true),
    textItem('Age', COLUMN_X.age, headerY, true),
    textItem('Birth Date', COLUMN_X.birth, headerY, true),
    textItem('Phone Number', COLUMN_X.phone, headerY, true),
    textItem('Email', COLUMN_X.email, headerY, true),
  ];
  const rows: PdfRow[] = [rowOf(63, [title]), rowOf(75, [unit]), rowOf(headerY, header)];
  const items: PdfTextItem[] = [title, unit, ...header];
  let y = 116;
  for (const member of members) {
    const parts = typeof member.name === 'string' ? [member.name] : member.name;
    const nameItems = parts.map((part, index) => textItem(part, COLUMN_X.name + index * 0.4, y));
    const memberItems = [
      ...nameItems,
      textItem(member.gender, COLUMN_X.gender, y),
      textItem(member.age, COLUMN_X.age, y),
      textItem('01 Jan 2010', COLUMN_X.birth, y),
      textItem('(555) 555-0199', COLUMN_X.phone, y),
      textItem('leaked.person@example.com', COLUMN_X.email, y),
    ];
    rows.push(rowOf(y, memberItems));
    items.push(...memberItems);
    y += 14;
  }
  const countItem = textItem(`Count: ${String(count)}`, COLUMN_X.name, y, true);
  rows.push(rowOf(y, [countItem]));
  items.push(countItem);
  y += 28;
  const footer = textItem(
    '25 Oct 2026     For Church Use Only © 2026 by Intellectual Reserve, Inc. All rights reserved.',
    156,
    y,
  );
  rows.push(rowOf(y, [footer]));
  items.push(footer);
  const page: PdfPage = { pageNumber: 1, width: 612, height: 792, items, rows };
  return { title: null, pageCount: 1, pages: [page] };
}

function assertNoPersonalValues(json: string, rows: readonly FixtureRow[]): void {
  // Ashby, Ella is printed F, 48, 17 Nov 1977, (555) 555-0254, ella.ashby76@example.com.
  const ella = rows.find((row) => row.name === 'Ashby, Ella');
  assert.ok(ella);
  assert.equal(ella.gender, 'F');
  assert.equal(ella.age, '48');
  assert.equal(ella.birthDate, '17 Nov 1977');
  assert.equal(ella.phone, '(555) 555-0254');
  assert.equal(ella.email, 'ella.ashby76@example.com');

  for (const row of rows) {
    if (row.phone !== '') assert.equal(json.includes(row.phone), false, row.phone);
    if (row.email !== '') assert.equal(json.includes(row.email), false, row.email);
    if (row.birthDate !== '') assert.equal(json.includes(row.birthDate), false, row.birthDate);
    assert.equal(json.includes(`"age":${row.age}`), false, row.age);
    assert.equal(json.includes(`"age":"${row.age}"`), false, row.age);
  }
  assert.equal(json.includes('"F"'), false);
  assert.equal(json.includes('"M"'), false);
  assert.equal(json.includes('Gender'), false);
  assert.equal(json.includes('Birth'), false);
  assert.equal(json.includes('Phone'), false);
  assert.equal(json.includes('Email'), false);
  assert.equal(json.includes('555'), false);
  assert.equal(json.includes('@'), false);
}

describe('T-111: Member List parser', () => {
  const doc = extractPdf(loadFixture('member-list.pdf'));
  const rows = fixtureRows(doc);

  it('parses the fixture member list', () => {
    const report = parseMemberList(doc);
    assert.deepEqual(parseMemberList(doc), report);

    assert.equal(report.kind, 'member-list');
    assert.equal(report.unitName, 'Cedar 14th Ward');
    assert.equal(report.reportDate, '2026-10-25');
    assert.equal(rows.length, 293);
    assert.equal(report.listedCount, 293);
    assert.equal(report.excludedUnder11, 33);
    assert.equal(report.entries.length, 260);
    assert.equal(report.entries.length + report.excludedUnder11, report.listedCount);

    const json = JSON.stringify(report);
    assert.equal(json.includes('100001'), false, 'unit number must not be kept');
    assert.equal(json.includes('200002'), false);

    // Ashby, Ella is 48 (adult). Ashby, Piper is 17 (youth). Ashby, Wyatt Roy is 18 (adult).
    assert.deepEqual(report.entries[0], { name: 'Ashby, Ella', category: 'adult' });
    assert.deepEqual(report.entries[1], { name: 'Ashby, Piper', category: 'youth' });
    assert.deepEqual(report.entries[2], { name: 'Ashby, Wyatt Roy', category: 'adult' });

    // Westdale, Gus is 11 (youth) and 39 (adult). Both rows are different people.
    assert.deepEqual(
      report.entries.filter((entry) => entry.name === 'Westdale, Gus'),
      [
        { name: 'Westdale, Gus', category: 'youth' },
        { name: 'Westdale, Gus', category: 'adult' },
      ],
    );

    // Fairwell, Sage Casey Kendall Reagan is 14 and 16, both youth, both kept.
    assert.deepEqual(
      report.entries.filter((entry) => entry.name === 'Fairwell, Sage Casey Kendall Reagan'),
      [
        { name: 'Fairwell, Sage Casey Kendall Reagan', category: 'youth' },
        { name: 'Fairwell, Sage Casey Kendall Reagan', category: 'youth' },
      ],
    );

    // Holwood, Opal is 11 (youth). Fairby, Kent is 18 (adult).
    assert.deepEqual(
      report.entries.find((entry) => entry.name === 'Holwood, Opal'),
      { name: 'Holwood, Opal', category: 'youth' },
    );
    assert.deepEqual(
      report.entries.find((entry) => entry.name === 'Fairby, Kent'),
      { name: 'Fairby, Kent', category: 'adult' },
    );

    assert.deepEqual(report.entries[report.entries.length - 1], {
      name: 'Yardton, Tina Ivy',
      category: 'adult',
    });
  });

  it('children under 11 are counted, not kept', () => {
    const report = parseMemberList(doc);
    const under11 = rows.filter((row) => /^\d+$/.test(row.age) && Number(row.age) < 11);
    assert.equal(under11.length, 33);
    assert.equal(report.excludedUnder11, under11.length);
    assert.equal(report.entries.length + report.excludedUnder11, report.listedCount);

    const kept = new Set(report.entries.map((entry) => entry.name));
    for (const row of under11) {
      assert.equal(kept.has(row.name), false, row.name);
    }
    // Ashwick, Bella Alise is 0. Harley, Brielle Bea is 10. Neither name is kept.
    assert.equal(
      under11.some((row) => row.name === 'Ashwick, Bella Alise'),
      true,
    );
    assert.equal(
      under11.some((row) => row.name === 'Harley, Brielle Bea'),
      true,
    );
    const json = JSON.stringify(report);
    assert.equal(json.includes('Ashwick, Bella Alise'), false);
    assert.equal(json.includes('Harley, Brielle Bea'), false);
  });

  it('the age boundaries map to the SPEC categories', () => {
    // Ages 10, 11, 17, and 18 are built rows, not fixture lookups.
    const built = builtMemberList(
      [
        { name: 'Bound, Ten', gender: 'F', age: '10' },
        { name: 'Bound, Eleven', gender: 'M', age: '11' },
        { name: 'Bound, Seventeen', gender: 'F', age: '17' },
        { name: 'Bound, Eighteen', gender: 'M', age: '18' },
      ],
      4,
    );
    const report = parseMemberList(built);
    assert.equal(report.listedCount, 4);
    assert.equal(report.excludedUnder11, 1);
    assert.deepEqual(report.entries, [
      { name: 'Bound, Eleven', category: 'youth' },
      { name: 'Bound, Seventeen', category: 'youth' },
      { name: 'Bound, Eighteen', category: 'adult' },
    ]);
    assert.equal(
      report.entries.some((entry) => entry.name === 'Bound, Ten'),
      false,
    );
  });

  it('wrapped names and page breaks parse', () => {
    const report = parseMemberList(doc);
    const keptRows = rows.filter((row) => /^\d+$/.test(row.age) && Number(row.age) >= 11);
    assert.deepEqual(
      nameCounts(report.entries.map((entry) => entry.name)),
      nameCounts(keptRows.map((row) => row.name)),
    );

    // Page 1 ends with Elmby, Vi (71, adult). Page 2 starts with Elmby, Wes T. (77, adult).
    const vi = report.entries.findIndex((entry) => entry.name === 'Elmby, Vi');
    assert.ok(vi >= 0);
    assert.deepEqual(report.entries[vi], { name: 'Elmby, Vi', category: 'adult' });
    assert.deepEqual(report.entries[vi + 1], { name: 'Elmby, Wes T.', category: 'adult' });
    assert.equal(report.entries.filter((entry) => entry.name === 'Elmby, Vi').length, 1);
    assert.equal(report.entries.filter((entry) => entry.name === 'Elmby, Wes T.').length, 1);

    // Page 6 ends with Yardby, Jo (57, adult). Page 7 starts with Yardby, Ned (61, adult).
    const jo = report.entries.findIndex((entry) => entry.name === 'Yardby, Jo');
    assert.ok(jo >= 0);
    assert.deepEqual(report.entries[jo + 1], { name: 'Yardby, Ned', category: 'adult' });

    // The long fixture name is one entry, not a split or a duplicate.
    const longName = 'Fairwell, Cameron Sage Bailey Dakota Skyler';
    assert.equal(report.entries.filter((entry) => entry.name === longName).length, 1);
    assert.equal(
      report.entries.some((entry) => entry.name === 'Fairwell, Cameron Sage Bailey Dakota'),
      false,
    );
    assert.equal(
      report.entries.some((entry) => entry.name === 'Skyler'),
      false,
    );

    // A wrapped name that is still two cells in the name column is one entry.
    const wrapped = builtMemberList(
      [{ name: ['Wrapped, First', 'Second Line'], gender: 'F', age: '16' }],
      1,
    );
    const wrappedReport = parseMemberList(wrapped);
    assert.deepEqual(wrappedReport.entries, [
      { name: 'Wrapped, First Second Line', category: 'youth' },
    ]);
    assert.equal(wrappedReport.entries.length, 1);
  });

  it('another report is refused', () => {
    for (const filename of OTHER_REPORTS) {
      const other = extractPdf(loadFixture(filename));
      assert.throws(
        () => parseMemberList(other),
        (err: unknown) => {
          assert.ok(err instanceof MemberListReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          assert.equal(err.page, 1);
          return true;
        },
      );
    }

    // Document metadata is not the printed title. A matching doc title with the wrong page is refused.
    const titled = extractPdf(loadFixture('out-of-unit-callings.pdf'));
    const spoofed: PdfDocument = { ...titled, title: 'Member List' };
    assert.throws(
      () => parseMemberList(spoofed),
      (err: unknown) => {
        assert.ok(err instanceof MemberListReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        assert.equal(err.page, 1);
        return true;
      },
    );

    const wrongHeadings = builtMemberList([{ name: 'Heading, Wrong', gender: 'F', age: '30' }], 1);
    const page = wrongHeadings.pages[0];
    assert.ok(page);
    const header = page.rows.find(isHeader);
    assert.ok(header);
    const swapped: PdfTextItem[] = header.items.map((item) =>
      item.text === 'Gender' ? { ...item, text: 'Age' } : item.text === 'Age' ? { ...item, text: 'Gender' } : item,
    );
    const brokenRows = page.rows.map((row) => (row === header ? { ...row, items: swapped } : row));
    const broken: PdfDocument = {
      ...wrongHeadings,
      pages: [{ ...page, rows: brokenRows, items: page.items.map((item) => (item.text === 'Gender' && item.bold ? { ...item, text: 'Age' } : item.text === 'Age' && item.bold ? { ...item, text: 'Gender' } : item)) }],
    };
    assert.throws(
      () => parseMemberList(broken),
      (err: unknown) => {
        assert.ok(err instanceof MemberListReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        assert.equal(err.page, 1);
        return true;
      },
    );
  });

  it('a bad age is refused without leaking the row', () => {
    const built = builtMemberList(
      [{ name: 'Quill, Leaked Name', gender: 'F', age: 'x' }],
      1,
    );
    assert.throws(
      () => parseMemberList(built),
      (err: unknown) => {
        assert.ok(err instanceof MemberListReportError);
        assert.equal(err.code, 'INVALID_AGE');
        assert.equal(err.page, 1);
        assert.equal(err.message.includes('Quill'), false);
        assert.equal(err.message.includes('Leaked'), false);
        assert.equal(err.message.includes('x'), false);
        assert.equal(err.message.includes('555'), false);
        assert.equal(err.message.includes('example.com'), false);
        assert.equal(err.message.includes('01 Jan 2010'), false);
        return true;
      },
    );
  });

  it('the output keeps only name and category', () => {
    const report = parseMemberList(doc);
    assert.deepEqual(
      Object.keys(report).sort(),
      ['entries', 'excludedUnder11', 'kind', 'listedCount', 'reportDate', 'unitName'],
    );
    for (const entry of report.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['category', 'name']);
      const category: string = entry.category;
      assert.ok(category === 'adult' || category === 'youth');
    }

    const json = JSON.stringify(report);
    assertNoPersonalValues(json, rows);

    // Ages are not stored. Drop labels and the structural numbers (the key
    // excludedUnder11 itself contains digits), then no digits remain.
    let stripped = json;
    for (const key of Object.keys(report)) stripped = stripped.replaceAll(key, '');
    const structural = [report.unitName, report.reportDate ?? '', String(report.listedCount), String(report.excludedUnder11)];
    for (const value of structural) {
      if (value !== '') stripped = stripped.replaceAll(value, '');
    }
    assert.equal(/\d/.test(stripped), false, stripped.match(/\d+/)?.[0] ?? 'digit');
  });
});
