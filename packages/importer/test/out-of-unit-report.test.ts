import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  extractPdf,
  OutOfUnitReportError,
  parseOutOfUnitReport,
  type PdfDocument,
} from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixtureDoc(filename: string): PdfDocument {
  const bytes = new Uint8Array(readFileSync(join(fixturesDir, filename)));
  return extractPdf(bytes);
}

describe('T-055: Out-of-Unit Callings parser', () => {
  const fixtureDoc = loadFixtureDoc('out-of-unit-callings.pdf');

  it('reads unit name and report date', () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    assert.equal(report.kind, 'out-of-unit');
    assert.equal(report.unitName, 'Cedar 14th Ward');
    assert.equal(report.reportDate, '2026-10-25');

    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('100001'), 'Unit number 100001 must not appear in output');
    assert.ok(!serialized.includes('200002'), 'Stake number 200002 must not appear in output');
  });

  it('parses 11 stake and 26 serving-outside-unit records in report order', () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    assert.equal(report.externalCallings.length, 37);

    const stakeRecords = report.externalCallings.filter((r) => r.section === 'stake');
    const servingRecords = report.externalCallings.filter((r) => r.section === 'serving-outside-unit');

    assert.equal(stakeRecords.length, 11);
    assert.equal(servingRecords.length, 26);

    // Report order: all stake records first, then serving-outside-unit records
    const expectedSections: string[] = [];
    for (let i = 0; i < 11; i++) expectedSections.push('stake');
    for (let i = 0; i < 26; i++) expectedSections.push('serving-outside-unit');
    assert.deepEqual(
      report.externalCallings.map((r) => r.section),
      expectedSections,
    );

    // First stake record
    assert.deepEqual(stakeRecords[0], {
      section: 'stake',
      name: 'Melford, Leo',
      calling: 'Stake Sports Specialist',
      servingUnit: null,
    });

    // First serving record
    assert.deepEqual(servingRecords[0], {
      section: 'serving-outside-unit',
      name: 'Lynton, Piper',
      calling: 'Stake Activities Committee Member',
      servingUnit: 'Lakeview Utah YSA 3rd Stake',
    });

    // Last serving record
    assert.deepEqual(servingRecords[servingRecords.length - 1], {
      section: 'serving-outside-unit',
      name: 'Dalton, Lois',
      calling: 'Temple Worker',
      servingUnit: 'Cedar Peak Utah Temple',
    });
  });

  it("uses each section's own columns", () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    const stakeRecords = report.externalCallings.filter((r) => r.section === 'stake');
    const servingRecords = report.externalCallings.filter((r) => r.section === 'serving-outside-unit');

    for (const record of stakeRecords) {
      assert.equal(record.servingUnit, null);
      assert.ok(record.name.length > 0);
      assert.ok(record.calling.length > 0);
    }

    for (const record of servingRecords) {
      assert.notEqual(record.servingUnit, null);
      assert.ok(typeof record.servingUnit === 'string' && record.servingUnit.length > 0);
      assert.ok(record.name.length > 0);
      assert.ok(record.calling.length > 0);
    }

    // Specific check for column alignment
    const firstServing = servingRecords[0];
    assert.ok(firstServing);
    assert.equal(firstServing.servingUnit, 'Lakeview Utah YSA 3rd Stake');
    assert.equal(firstServing.calling, 'Stake Activities Committee Member');
    assert.equal(firstServing.name, 'Lynton, Piper');
  });

  it('keeps ward-role titles as external records', () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    const ryderBishop = report.externalCallings.find(
      (r) => r.name === 'Ivydale, Ryder' && r.calling === 'Bishop',
    );
    assert.ok(ryderBishop, 'Ivydale, Ryder Bishop record must be found');
    assert.equal(ryderBishop.section, 'serving-outside-unit');
    assert.equal(ryderBishop.servingUnit, 'Lakeview Married Student 8th Ward');
    assert.deepEqual(Object.keys(ryderBishop).sort(), ['calling', 'name', 'section', 'servingUnit']);
  });

  it('keeps multiple callings for one member', () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    const ryderCallings = report.externalCallings.filter((r) => r.name === 'Ivydale, Ryder');
    assert.equal(ryderCallings.length, 2);
    assert.deepEqual(
      ryderCallings.map((r) => r.calling).sort(),
      ['Bishop', 'Priests Quorum President'],
    );
    assert.ok(ryderCallings.every((r) => r.servingUnit === 'Lakeview Married Student 8th Ward'));

    const edieCallings = report.externalCallings.filter((r) => r.name === 'Birchwood, Edie');
    assert.equal(edieCallings.length, 2);
    assert.deepEqual(
      edieCallings.map((r) => r.calling).sort(),
      ['FamilySearch Center Coordinator', 'Stake Temple and Family History Consultant'],
    );
    assert.ok(edieCallings.every((r) => r.section === 'stake' && r.servingUnit === null));
  });

  it('drops sustained dates', () => {
    const report = parseOutOfUnitReport(fixtureDoc);

    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('May 2026'), 'Date "May 2026" must be dropped');
    assert.ok(!serialized.includes('Aug 2021'), 'Date "Aug 2021" must be dropped');
    assert.ok(!serialized.includes('Sustained'), 'Column header "Sustained" must not appear in output');

    for (const record of report.externalCallings) {
      assert.deepEqual(Object.keys(record), ['section', 'name', 'calling', 'servingUnit']);
    }
  });

  it('accepts an empty Living outside of Unit section', () => {
    const report = parseOutOfUnitReport(fixtureDoc);
    // Fixture has Living outside of Unit with Count: 0; parses cleanly with no third-section records
    assert.ok(report);
    assert.equal(report.externalCallings.length, 37);
  });

  it('maps a non-empty Living outside of Unit section', () => {
    const docCopy = structuredClone(fixtureDoc);
    const page = docCopy.pages[0];
    assert.ok(page);

    // Find the Living outside of Unit column header row
    const livingHeaderIdx = page.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Calling') &&
      r.items.some((it) => it.text === 'Name' && Math.abs(it.x - 205.84) < 5),
    );
    assert.ok(livingHeaderIdx !== -1, 'Living outside of Unit column header row must exist');
    const livingHeaderRow = page.rows[livingHeaderIdx];
    assert.ok(livingHeaderRow);

    // Insert a data row
    const insertedRow = {
      y: livingHeaderRow.y + 15,
      items: [
        {
          text: 'Fictional Calling Title',
          x: 44.25,
          y: livingHeaderRow.y + 15,
          fontSize: 9,
          fontName: 'LiberationSans',
          bold: false,
          italic: false,
        },
        {
          text: 'Nonexistent, FictionalPerson',
          x: 207.34,
          y: livingHeaderRow.y + 15,
          fontSize: 9,
          fontName: 'Helvetica',
          bold: false,
          italic: false,
        },
        {
          text: '1 Jan 2026',
          x: 342.19,
          y: livingHeaderRow.y + 15,
          fontSize: 9,
          fontName: 'LiberationSans',
          bold: false,
          italic: false,
        },
      ],
    };

    // Update Count: 0 to Count: 1
    const livingCountIdx = page.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Count: 0'),
    );
    assert.ok(livingCountIdx !== -1, 'Count: 0 row must exist');
    const livingCountRow = page.rows[livingCountIdx];
    assert.ok(livingCountRow);
    const updatedCountRow = {
      y: livingCountRow.y + 15,
      items: [
        {
          text: 'Count: 1',
          x: 42,
          y: livingCountRow.y + 15,
          fontSize: 9,
          fontName: 'LiberationSans',
          bold: false,
          italic: false,
        },
      ],
    };

    const newRows = [
      ...page.rows.slice(0, livingHeaderIdx + 1),
      insertedRow,
      updatedCountRow,
      ...page.rows.slice(livingCountIdx + 1),
    ];
    (page as unknown as { rows: typeof newRows }).rows = newRows;

    const report = parseOutOfUnitReport(docCopy);
    assert.equal(report.externalCallings.length, 38);
    const lastRecord = report.externalCallings[report.externalCallings.length - 1];
    assert.deepEqual(lastRecord, {
      section: 'living-outside-unit',
      name: 'Nonexistent, FictionalPerson',
      calling: 'Fictional Calling Title',
      servingUnit: null,
    });
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('1 Jan 2026'), 'Sustained value must be absent from output');
  });

  it('rejects another report as WRONG_REPORT', () => {
    const wrongDoc = loadFixtureDoc('members-without-callings.pdf');

    let caughtError: OutOfUnitReportError | null = null;
    try {
      parseOutOfUnitReport(wrongDoc);
    } catch (err) {
      if (err instanceof OutOfUnitReportError) {
        caughtError = err;
      }
    }

    assert.ok(caughtError, 'Expected OutOfUnitReportError to be thrown');
    assert.equal(caughtError.code, 'WRONG_REPORT');
    assert.equal(caughtError.page, 1);
  });

  it('throws COUNT_MISMATCH when a row is missing', () => {
    const docCopy = structuredClone(fixtureDoc);
    const page = docCopy.pages[0];
    assert.ok(page);

    // Find the serving outside section and remove one data row
    const servingHeaderIdx = page.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Serving outside of assigned unit'),
    );
    assert.ok(servingHeaderIdx !== -1);

    // Delete the row right after table headers (first data row in serving section)
    const tableHeaderIdx = servingHeaderIdx + 1;
    const firstDataRowIdx = tableHeaderIdx + 1;

    const newRows = [
      ...page.rows.slice(0, firstDataRowIdx),
      ...page.rows.slice(firstDataRowIdx + 1),
    ];
    (page as unknown as { rows: typeof newRows }).rows = newRows;

    let caughtError: OutOfUnitReportError | null = null;
    try {
      parseOutOfUnitReport(docCopy);
    } catch (err) {
      if (err instanceof OutOfUnitReportError) {
        caughtError = err;
      }
    }

    assert.ok(caughtError, 'Expected OutOfUnitReportError to be thrown');
    assert.equal(caughtError.code, 'COUNT_MISMATCH');
    assert.ok(
      caughtError.message.includes('Serving outside of assigned unit'),
      `Message must name the section, got: ${caughtError.message}`,
    );
    // Ensure no personal names in message
    assert.ok(!caughtError.message.includes('Lynton'));
    assert.ok(!caughtError.message.includes('Piper'));
  });

  it('throws UNRECOGNIZED_LAYOUT when a section header is missing or unknown', () => {
    // (a) Remove the Stake Callings header row
    {
      const docCopy = structuredClone(fixtureDoc);
      const page = docCopy.pages[0];
      assert.ok(page);
      const stakeHeaderIdx = page.rows.findIndex((r) =>
        r.items.some((it) => it.text === 'Stake Callings'),
      );
      assert.ok(stakeHeaderIdx !== -1);

      (page as unknown as { rows: unknown }).rows = [
        ...page.rows.slice(0, stakeHeaderIdx),
        ...page.rows.slice(stakeHeaderIdx + 1),
      ];

      assert.throws(
        () => parseOutOfUnitReport(docCopy),
        (err: unknown) => {
          assert.ok(err instanceof OutOfUnitReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          return true;
        },
      );
    }

    // (b) Rename Stake Callings to Ward Callings
    {
      const docCopy = structuredClone(fixtureDoc);
      const page = docCopy.pages[0];
      assert.ok(page);
      const stakeHeaderIdx = page.rows.findIndex((r) =>
        r.items.some((it) => it.text === 'Stake Callings'),
      );
      assert.ok(stakeHeaderIdx !== -1);
      const stakeRow = page.rows[stakeHeaderIdx];
      assert.ok(stakeRow);

      const modifiedRow = {
        ...stakeRow,
        items: stakeRow.items.map((it) =>
          it.text === 'Stake Callings' ? { ...it, text: 'Ward Callings' } : it,
        ),
      };

      (page as unknown as { rows: unknown }).rows = [
        ...page.rows.slice(0, stakeHeaderIdx),
        modifiedRow,
        ...page.rows.slice(stakeHeaderIdx + 1),
      ];

      assert.throws(
        () => parseOutOfUnitReport(docCopy),
        (err: unknown) => {
          assert.ok(err instanceof OutOfUnitReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          return true;
        },
      );
    }
  });

  it('throws UNRECOGNIZED_LAYOUT when unit name or report date is missing', () => {
    // Missing unit name
    {
      const docCopy = structuredClone(fixtureDoc);
      const page = docCopy.pages[0];
      assert.ok(page);
      // Remove header rows
      (page as unknown as { rows: unknown }).rows = page.rows.filter((r) => r.y >= 30);

      assert.throws(
        () => parseOutOfUnitReport(docCopy),
        (err: unknown) => {
          assert.ok(err instanceof OutOfUnitReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          return true;
        },
      );
    }

    // Missing footer date
    {
      const docCopy = structuredClone(fixtureDoc);
      const page = docCopy.pages[0];
      assert.ok(page);
      // Remove footer rows
      (page as unknown as { rows: unknown }).rows = page.rows.filter((r) => r.y <= 770);

      assert.throws(
        () => parseOutOfUnitReport(docCopy),
        (err: unknown) => {
          assert.ok(err instanceof OutOfUnitReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          return true;
        },
      );
    }
  });

  it('accepts Month D, YYYY footer date format', () => {
    const docCopy = structuredClone(fixtureDoc);
    const page = docCopy.pages[0];
    assert.ok(page);

    const footerRowIdx = page.rows.findIndex((r) => r.y > 770);
    assert.ok(footerRowIdx !== -1);
    const footerRow = page.rows[footerRowIdx];
    assert.ok(footerRow);

    const modifiedFooter = {
      ...footerRow,
      items: footerRow.items.map((it) =>
        it.text === '25 Oct 2026' ? { ...it, text: 'October 25, 2026' } : it,
      ),
    };

    (page as unknown as { rows: unknown }).rows = [
      ...page.rows.slice(0, footerRowIdx),
      modifiedFooter,
      ...page.rows.slice(footerRowIdx + 1),
    ];

    const report = parseOutOfUnitReport(docCopy);
    assert.equal(report.reportDate, '2026-10-25');
  });

  it('throws UNRECOGNIZED_LAYOUT for empty pages or null title', () => {
    assert.throws(
      () => parseOutOfUnitReport({ title: null, pageCount: 0, pages: [] }),
      (err: unknown) => {
        assert.ok(err instanceof OutOfUnitReportError);
        assert.equal(err.code, 'WRONG_REPORT');
        return true;
      },
    );

    assert.throws(
      () => parseOutOfUnitReport({ title: 'Out-of-Unit Callings', pageCount: 0, pages: [] }),
      (err: unknown) => {
        assert.ok(err instanceof OutOfUnitReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        return true;
      },
    );
  });

  it('throws UNRECOGNIZED_LAYOUT for non-bold column header row', () => {
    const docCopy = structuredClone(fixtureDoc);
    const page = docCopy.pages[0];
    assert.ok(page);

    const stakeHeaderIdx = page.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Stake Callings'),
    );
    const tableHeaderIdx = stakeHeaderIdx + 1;
    const tableHeaderRow = page.rows[tableHeaderIdx];
    assert.ok(tableHeaderRow);

    const modifiedHeader = {
      ...tableHeaderRow,
      items: tableHeaderRow.items.map((it) => ({ ...it, bold: false })),
    };

    (page as unknown as { rows: unknown }).rows = [
      ...page.rows.slice(0, tableHeaderIdx),
      modifiedHeader,
      ...page.rows.slice(tableHeaderIdx + 1),
    ];

    assert.throws(
      () => parseOutOfUnitReport(docCopy),
      (err: unknown) => {
        assert.ok(err instanceof OutOfUnitReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        return true;
      },
    );
  });


  it('is deterministic', () => {
    const report1 = parseOutOfUnitReport(fixtureDoc);
    const report2 = parseOutOfUnitReport(fixtureDoc);

    assert.deepEqual(report1, report2);
  });
});
