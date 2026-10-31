import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import type { PdfDocument, PdfPage, PdfRow } from '../src/index.ts';
import {
  categoryForAge,
  extractPdf,
  parseWithoutCallingsReport,
  WithoutCallingsReportError,
} from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function cloneDoc(doc: PdfDocument): PdfDocument {
  return JSON.parse(JSON.stringify(doc)) as PdfDocument;
}

describe('T-054: Members without Callings parser', () => {
  const withoutCallingsBytes = loadFixture('members-without-callings.pdf');
  const outOfUnitBytes = loadFixture('out-of-unit-callings.pdf');

  it('reads unit name, report date and listed count', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);

    assert.equal(report.kind, 'without-callings');
    assert.equal(report.unitName, 'Cedar 14th Ward');
    assert.equal(report.reportDate, '2026-10-25');
    assert.equal(report.listedCount, 145);

    const json = JSON.stringify(report);
    assert.ok(!json.includes('100001'), 'output must not contain unit number 100001');
    assert.ok(!json.includes('200002'), 'output must not contain stake number 200002');
  });

  it('classifies 90 adults and 22 youth and excludes 33 under 11', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);

    const adults = report.candidates.filter((c) => c.category === 'adult');
    const youth = report.candidates.filter((c) => c.category === 'youth');

    assert.equal(adults.length, 90);
    assert.equal(youth.length, 22);
    assert.equal(report.excludedUnder11, 33);
    assert.equal(report.candidates.length, 112);
    assert.equal(report.listedCount, report.candidates.length + report.excludedUnder11);

    const names = report.candidates.map((c) => c.name);
    assert.equal(new Set(names).size, report.candidates.length, 'no duplicate candidate names');
  });

  it('keeps report order across page breaks', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);

    assert.deepEqual(report.candidates[0], { name: 'Kelley, Kaia', category: 'adult', gender: 'F' });
    assert.deepEqual(report.candidates[1], { name: 'Kelley, Talia', category: 'adult', gender: 'F' });
    assert.deepEqual(report.candidates[2], { name: 'Lynton, Joy', category: 'adult', gender: 'F' });
    assert.deepEqual(report.candidates[report.candidates.length - 1], {
      name: 'Dalton, Hal',
      category: 'adult',
      gender: 'M',
    });

    const gilleyKyIdx = report.candidates.findIndex((c) => c.name === 'Gilley, Ky Lila');
    assert.ok(gilleyKyIdx !== -1, 'Gilley, Ky Lila must be present');
    assert.equal(report.candidates[gilleyKyIdx]?.category, 'youth');

    const nextCandidate = report.candidates[gilleyKyIdx + 1];
    assert.ok(nextCandidate, 'next candidate must exist');
    assert.deepEqual(nextCandidate, { name: 'Birchwood, Hallie', category: 'adult', gender: 'F' });

    const iris = report.candidates.find((c) => c.name === 'Gilley, Iris Velma');
    assert.equal(iris, undefined, 'Gilley, Iris Velma (7) must be absent');
  });

  it('applies the 10/11/17/18 boundaries to fixture members', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);

    const harley = report.candidates.find((c) => c.name.includes('Harley, Brielle Bea'));
    assert.equal(harley, undefined, 'Harley (10) must be excluded');

    const holwood = report.candidates.find((c) => c.name === 'Holwood, Opal');
    assert.deepEqual(holwood, { name: 'Holwood, Opal', category: 'youth', gender: 'F' });

    const fairfield = report.candidates.find((c) => c.name === 'Fairfield, Neal Dean');
    assert.deepEqual(fairfield, { name: 'Fairfield, Neal Dean', category: 'youth', gender: 'M' });

    const fairby = report.candidates.find((c) => c.name === 'Fairby, Kent');
    assert.deepEqual(fairby, { name: 'Fairby, Kent', category: 'adult', gender: 'M' });
  });

  it('categoryForAge maps the SPEC boundaries and rejects bad ages', () => {
    assert.equal(categoryForAge(0), 'excluded');
    assert.equal(categoryForAge(10), 'excluded');
    assert.equal(categoryForAge(11), 'youth');
    assert.equal(categoryForAge(17), 'youth');
    assert.equal(categoryForAge(18), 'adult');
    assert.equal(categoryForAge(99), 'adult');

    assert.throws(() => categoryForAge(-1), RangeError);
    assert.throws(() => categoryForAge(10.5), RangeError);
    assert.throws(() => categoryForAge(NaN), RangeError);
    assert.throws(() => categoryForAge(Infinity), RangeError);
    assert.throws(() => categoryForAge(-Infinity), RangeError);
  });

  it('candidate objects carry only name, category and gender', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);

    for (const c of report.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['category', 'gender', 'name']);
    }
    assert.deepEqual(
      Object.keys(report).sort(),
      ['candidates', 'excludedUnder11', 'kind', 'listedCount', 'reportDate', 'unitName'].sort(),
    );
  });

  it('never emits age, birth date or phone values', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report = parseWithoutCallingsReport(doc);
    const json = JSON.stringify(report);

    assert.ok(!json.includes('555'), 'must not contain phone 555');
    assert.ok(!json.includes('Birth'), 'must not contain Birth');
    assert.ok(!json.includes('1974'), 'must not contain birth year 1974');
    assert.ok(!json.includes('31 Jan 1974'), 'must not contain birth date 31 Jan 1974');
    assert.ok(json.includes('"F"'), 'must contain gender "F"');
    assert.ok(json.includes('"M"'), 'must contain gender "M"');
    assert.ok(!json.includes('Harley, Brielle Bea'), 'must not contain excluded member Brielle Bea');
    assert.ok(!json.includes('Elmfield, Paige Ida'), 'must not contain excluded member Paige Ida');
  });

  it('rejects another report as WRONG_REPORT', () => {
    const doc = extractPdf(outOfUnitBytes);
    assert.throws(
      () => parseWithoutCallingsReport(doc),
      (err: unknown) => {
        assert.ok(err instanceof WithoutCallingsReportError);
        assert.equal(err.code, 'WRONG_REPORT');
        assert.equal(err.page, 1);
        return true;
      },
    );
  });

  it('throws COUNT_MISMATCH when a member row is missing', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const modifiedDoc = cloneDoc(doc);
    const p3 = modifiedDoc.pages[2] as PdfPage;
    // Remove one member row (between header and y=775)
    const rowToRemoveIdx = p3.rows.findIndex(
      (r) => r.y >= 30 && r.y <= 775 && !r.items.some((it) => it.text === 'Name'),
    );
    assert.ok(rowToRemoveIdx !== -1);
    const removedRow = p3.rows[rowToRemoveIdx];
    (p3.rows as PdfRow[]).splice(rowToRemoveIdx, 1);

    assert.throws(
      () => parseWithoutCallingsReport(modifiedDoc),
      (err: unknown) => {
        assert.ok(err instanceof WithoutCallingsReportError);
        assert.equal(err.code, 'COUNT_MISMATCH');
        // Error message must not contain any member name
        const memberName = removedRow?.items[0]?.text ?? '';
        if (memberName) {
          assert.ok(!err.message.includes(memberName), 'error must not leak member name');
        }
        return true;
      },
    );
  });

  it('throws UNRECOGNIZED_LAYOUT for a missing age, a missing header, and a missing Count', () => {
    const doc = extractPdf(withoutCallingsBytes);

    // 1. Missing age on a member row
    {
      const modifiedDoc = cloneDoc(doc);
      const p1 = modifiedDoc.pages[0] as PdfPage;
      const memberRow = p1.rows.find(
        (r) => r.y >= 30 && r.y <= 775 && !r.items.some((it) => it.text === 'Name'),
      );
      assert.ok(memberRow);
      // Remove the age item (digits only item)
      (memberRow.items as Array<PdfRow['items'][number]>) = memberRow.items.filter(
        (it) => !/^\d+$/.test(it.text),
      );

      assert.throws(
        () => parseWithoutCallingsReport(modifiedDoc),
        (err: unknown) => {
          assert.ok(err instanceof WithoutCallingsReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          assert.equal(err.page, 1);
          return true;
        },
      );
    }

    // 2. Missing table header row on a page with member rows
    {
      const modifiedDoc = cloneDoc(doc);
      const p2 = modifiedDoc.pages[1] as PdfPage;
      (p2.rows as PdfRow[]) = p2.rows.filter(
        (r) => !r.items.some((it) => it.text === 'Name'),
      );

      assert.throws(
        () => parseWithoutCallingsReport(modifiedDoc),
        (err: unknown) => {
          assert.ok(err instanceof WithoutCallingsReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          assert.equal(err.page, 2);
          return true;
        },
      );
    }

    // 3. Missing Count footer on the last page
    {
      const modifiedDoc = cloneDoc(doc);
      const lastPage = modifiedDoc.pages[modifiedDoc.pages.length - 1] as PdfPage;
      (lastPage.rows as PdfRow[]) = lastPage.rows.filter(
        (r) => !r.items.some((it) => it.text.includes('Count:')),
      );

      assert.throws(
        () => parseWithoutCallingsReport(modifiedDoc),
        (err: unknown) => {
          assert.ok(err instanceof WithoutCallingsReportError);
          assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
          assert.equal(err.page, 4);
          return true;
        },
      );
    }
  });

  it('is deterministic', () => {
    const doc = extractPdf(withoutCallingsBytes);
    const report1 = parseWithoutCallingsReport(doc);
    const report2 = parseWithoutCallingsReport(doc);

    assert.deepEqual(report1, report2);
  });
});
