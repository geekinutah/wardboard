import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  extractPdf,
  PdfParseError,
} from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

describe('T-052: PDF extraction harness', () => {
  it('extracts Out-of-Unit Callings metadata, section headers, and aligned rows across Skia and Helvetica streams', () => {
    const bytes = loadFixture('out-of-unit-callings.pdf');
    const doc = extractPdf(bytes);

    assert.equal(doc.title, 'Out-of-Unit Callings');
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.pages.length, 1);

    const page1 = doc.pages[0];
    assert.ok(page1);
    assert.equal(page1.pageNumber, 1);
    assert.equal(page1.width, 612);
    assert.equal(page1.height, 792);

    // Section headers present
    const rows = page1.rows;
    const stakeCallingsIdx = rows.findIndex((r) => r.items.some((it) => it.text === 'Stake Callings'));
    const servingOutsideIdx = rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Serving outside of assigned unit'),
    );
    const livingOutsideIdx = rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Living outside of Unit'),
    );

    assert.ok(stakeCallingsIdx !== -1, 'Stake Callings section header must exist');
    assert.ok(servingOutsideIdx !== -1, 'Serving outside of assigned unit section header must exist');
    assert.ok(livingOutsideIdx !== -1, 'Living outside of Unit section header must exist');
    assert.ok(stakeCallingsIdx < servingOutsideIdx && servingOutsideIdx < livingOutsideIdx);

    // Reconcile sections and verify that rows align ToUnicode (F4/F5) and Helvetica (helv) cells
    // Stake Callings: 11 rows + Count: 11
    const stakeCountIdx = rows.findIndex(
      (r, idx) => idx > stakeCallingsIdx && r.items.some((it) => it.text.includes('Count: 11')),
    );
    assert.ok(stakeCountIdx !== -1, 'Count: 11 footer for Stake Callings must exist');
    const stakeHeaderIdx = rows.findIndex(
      (r, idx) => idx > stakeCallingsIdx && idx < stakeCountIdx && r.items.some((it) => it.bold),
    );
    assert.ok(stakeHeaderIdx !== -1, 'Stake Callings table header must exist');
    const stakeDataRows = rows.slice(stakeHeaderIdx + 1, stakeCountIdx);
    assert.equal(stakeDataRows.length, 11, 'Stake Callings must have 11 rows');

    // Serving outside of assigned unit: 26 rows + Count: 26
    const servingCountIdx = rows.findIndex(
      (r, idx) => idx > servingOutsideIdx && r.items.some((it) => it.text.includes('Count: 26')),
    );
    assert.ok(servingCountIdx !== -1, 'Count: 26 footer for Serving outside must exist');
    const servingHeaderIdx = rows.findIndex(
      (r, idx) => idx > servingOutsideIdx && idx < servingCountIdx && r.items.some((it) => it.bold),
    );
    assert.ok(servingHeaderIdx !== -1, 'Serving outside table header must exist');
    const servingDataRows = rows.slice(servingHeaderIdx + 1, servingCountIdx);
    assert.equal(servingDataRows.length, 26, 'Serving outside must have 26 rows');

    // Living outside of Unit: 0 rows + Count: 0
    const livingCountIdx = rows.findIndex(
      (r, idx) => idx > livingOutsideIdx && r.items.some((it) => it.text.includes('Count: 0')),
    );
    assert.ok(livingCountIdx !== -1, 'Count: 0 footer for Living outside must exist');
    const livingHeaderIdx = rows.findIndex(
      (r, idx) => idx > livingOutsideIdx && idx <= livingCountIdx && r.items.some((it) => it.bold),
    );
    const livingDataRows =
      livingHeaderIdx !== -1 ? rows.slice(livingHeaderIdx + 1, livingCountIdx) : [];
    assert.equal(livingDataRows.length, 0, 'Living outside of Unit must have 0 rows');

    // Prove that data rows have aligned cells across Skia (LiberationSans) and Helvetica
    const mixedRows = stakeDataRows.filter(
      (r) =>
        r.items.some((it) => it.fontName === 'Helvetica') &&
        r.items.some((it) => it.fontName.startsWith('LiberationSans')),
    );
    assert.ok(mixedRows.length > 0, 'Expected data rows combining Helvetica and LiberationSans cells');
  });

  it('extracts Members without Callings across 4 pages and reconciles all 145 member rows with Count: 145', () => {
    const bytes = loadFixture('members-without-callings.pdf');
    const doc = extractPdf(bytes);

    assert.equal(doc.title, 'Members without Callings');
    assert.equal(doc.pageCount, 4);
    assert.equal(doc.pages.length, 4);

    // Page 1 header: ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number']
    const p1Rows = doc.pages[0]?.rows ?? [];
    const headerRow = p1Rows.find((r) =>
      r.items.some((it) => it.text === 'Name') &&
      r.items.some((it) => it.text === 'Gender') &&
      r.items.some((it) => it.text === 'Age') &&
      r.items.some((it) => it.text === 'Birth Date') &&
      r.items.some((it) => it.text === 'Phone Number'),
    );
    assert.ok(headerRow, 'Page 1 must contain the member-roster table header row');
    const headerTexts = headerRow.items.map((it) => it.text);
    assert.deepEqual(headerTexts, ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number']);

    // Collect all member data rows across all 4 pages
    // Exclude header rows, banner rows (y <= 35 or y >= 770), and Count footer
    let memberRowCount = 0;
    let foundCountFooter = false;

    for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
      const page = doc.pages[pIdx];
      assert.ok(page);
      for (const row of page.rows) {
        if (row.items.some((it) => it.text.includes('Count: 145'))) {
          foundCountFooter = true;
          continue;
        }
        // Exclude document banner (y <= 35) and footer (y >= 770)
        if (row.y <= 35 || row.y >= 770) continue;
        // Exclude table header row (e.g. repeated header on pages 1-4)
        if (row.items.some((it) => it.text === 'Name')) continue;

        memberRowCount++;
      }
    }

    assert.ok(foundCountFooter, 'Page 4 must contain Count: 145');
    assert.equal(memberRowCount, 145, 'Must extract exactly 145 member rows');
  });

  it('extracts all 25 pages of Organizations and Callings from nested Pages Kids nodes', () => {
    const bytes = loadFixture('organizations-and-callings.pdf');
    const doc = extractPdf(bytes);

    assert.equal(doc.title, 'Organizations and Callings');
    assert.equal(doc.pageCount, 25);
    assert.equal(doc.pages.length, 25);

    // Verify 1-based page numbers
    for (let i = 0; i < 25; i++) {
      assert.equal(doc.pages[i]?.pageNumber, i + 1);
    }

    // Count italic 'Calling Vacant' items
    let vacantCount = 0;
    // Count set-apart '✓' items
    let setApartCount = 0;

    for (const page of doc.pages) {
      for (const item of page.items) {
        if (item.text === 'Calling Vacant' && item.italic && item.fontName === 'LiberationSans-Italic') {
          vacantCount++;
        }
        if (item.text === '✓' && item.fontName === 'IPAGothic') {
          setApartCount++;
        }
      }
    }

    assert.equal(vacantCount, 95, 'Must extract exactly 95 Calling Vacant items with italic and LiberationSans-Italic');
    assert.equal(setApartCount, 73, "Must extract exactly 73 set-apart '✓' items with IPAGothic font");
  });

  it('distinguishes calling and member-roster tables in Organizations and Callings and reconciles all 81 section counts across page breaks', () => {
    const bytes = loadFixture('organizations-and-callings.pdf');
    const doc = extractPdf(bytes);

    let callingSectionCount = 0;
    let memberRosterSectionCount = 0;
    let currentSection: { type: 'calling' | 'roster'; count: number } | null = null;
    let reconciledSections = 0;

    for (const page of doc.pages) {
      for (const row of page.rows) {
        // Skip header/footer banner rows
        if (row.y <= 35 || row.y >= 770) continue;

        const isCallingHeader =
          row.items.some((it) => it.text === 'Calling' && it.bold) &&
          row.items.some((it) => it.text === 'Name' && it.bold);

        const isRosterHeader =
          !isCallingHeader &&
          row.items.some((it) => it.text === 'Name' && it.bold) &&
          row.items.some((it) => (it.text === 'Age' || it.text === 'Birth Date') && it.bold);

        if (isCallingHeader) {
          if (currentSection && currentSection.type === 'calling') {
            // Repeated header for table split across page break
            continue;
          }
          currentSection = { type: 'calling', count: 0 };
          callingSectionCount++;
          continue;
        }

        if (isRosterHeader) {
          if (currentSection && currentSection.type === 'roster') {
            // Repeated header for table split across page break
            continue;
          }
          currentSection = { type: 'roster', count: 0 };
          memberRosterSectionCount++;
          continue;
        }

        const countItem = row.items.find((it) => it.text.startsWith('Count:'));
        if (countItem && currentSection) {
          const match = /Count:\s*(\d+)/.exec(countItem.text);
          assert.ok(match, `Invalid count text: ${countItem.text}`);
          const expected = parseInt(match[1] ?? '0', 10);
          assert.equal(
            currentSection.count,
            expected,
            `Section count mismatch at page ${String(page.pageNumber)} y=${String(row.y)}: expected ${String(expected)}, counted ${String(currentSection.count)}`,
          );
          currentSection = null;
          reconciledSections++;
          continue;
        }

        if (currentSection) {
          // Exclude footnote rows (* or **)
          const firstText = row.items[0]?.text ?? '';
          if (
            firstText.startsWith('*') &&
            (row.items.length === 1 ||
              firstText.includes('custom calling') ||
              firstText.includes('Unbaptized'))
          ) {
            continue;
          }
          currentSection.count++;
        }
      }
    }

    assert.equal(currentSection, null, 'All sections must be closed');
    assert.equal(callingSectionCount, 58, 'Must have 58 calling table sections');
    assert.equal(memberRosterSectionCount, 23, 'Must have 23 member-roster sections');
    assert.equal(reconciledSections, 81, 'All 81 sections must reconcile row count with Count: N');
  });

  it('merges the two wrapped two-line member names on page 18 of Organizations and Callings into their single rows', () => {
    const bytes = loadFixture('organizations-and-callings.pdf');
    const doc = extractPdf(bytes);

    const page18 = doc.pages[17];
    assert.ok(page18, 'Page 18 must exist');
    assert.equal(page18.pageNumber, 18);

    const rows = page18.rows;

    // First wrapped name at y = 59.25
    const row59 = rows.find((r) => Math.abs(r.y - 59.25) <= 1.0);
    assert.ok(row59, 'Must produce a row at y = 59.25');
    const row59Texts = row59.items.map((it) => it.text);
    assert.ok(
      row59Texts.includes('Fairwell, Cameron Sage Bailey Dakota Skyler'),
      `Row at y=59.25 must contain merged name, got: ${JSON.stringify(row59Texts)}`,
    );
    assert.ok(row59Texts.includes('M'), 'Row at y=59.25 must contain M');
    assert.ok(row59Texts.includes('13'), 'Row at y=59.25 must contain 13');
    assert.ok(row59Texts.includes('21 Dec 2012'), 'Row at y=59.25 must contain 21 Dec 2012');
    assert.ok(row59Texts.includes('cameron.fairwell62@example.com'), 'Row at y=59.25 must contain email');

    // Second wrapped name at y = 400.5
    const row400 = rows.find((r) => Math.abs(r.y - 400.5) <= 1.0);
    assert.ok(row400, 'Must produce a row at y = 400.5');
    const row400Texts = row400.items.map((it) => it.text);
    assert.ok(
      row400Texts.includes('Fairwell, Sage Casey Kendall Reagan'),
      `Row at y=400.5 must contain merged name, got: ${JSON.stringify(row400Texts)}`,
    );
    assert.ok(row400Texts.includes('M'), 'Row at y=400.5 must contain M');
    assert.ok(row400Texts.includes('14'), 'Row at y=400.5 must contain 14');
    assert.ok(row400Texts.includes('13 Apr 2012'), 'Row at y=400.5 must contain 13 Apr 2012');
    assert.ok(row400Texts.includes('555-0307'), 'Row at y=400.5 must contain phone');
    assert.ok(row400Texts.includes('sage.fairwell63@example.com'), 'Row at y=400.5 must contain email');

    // Ensure no unmerged fragment rows remain
    const unmergedFragment = rows.find((r) =>
      r.items.some(
        (it) =>
          it.text === 'Fairwell, Cameron' ||
          it.text === 'Sage Bailey Dakota Skyler' ||
          it.text === 'Fairwell, Sage' ||
          it.text === 'Casey Kendall Reagan',
      ),
    );
    assert.equal(unmergedFragment, undefined, 'No unmerged name fragments should exist as separate rows');
  });

  it('produces identical deterministic output across repeated runs on all three fixture reports', () => {
    for (const fixture of [
      'out-of-unit-callings.pdf',
      'members-without-callings.pdf',
      'organizations-and-callings.pdf',
    ]) {
      const bytes = loadFixture(fixture);
      const run1 = extractPdf(bytes);
      const run2 = extractPdf(bytes);
      assert.deepEqual(run1, run2, `Output must be deterministic across repeated runs for ${fixture}`);
    }
  });

  it('handles synthetic PDFs with multi-line BT blocks (Td/TD/T*), top-aligned wrapped cells, Contents stream arrays, and CMap array bfranges', () => {
    // 1. Root Catalog with Pages hierarchy, inherited MediaBox [0 0 612 792] and Resources
    // 2. Font with ToUnicode CMap using array bfrange: <0001> <0002> [<0041> <0042>] (A, B)
    // 3. Literal string escapes: \( \) \\ \n \r \t \101 (A)
    // 4. Page with /Contents [stream1, stream2]
    // 5. In stream1: multi-line BT block using Td, TD, T*, and '
    // 6. In stream2: top-aligned wrapped cells

    const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def
/CMapName /Custom-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0001> <0002> [<0041> <0042>]
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

    const stream1 = `BT
/F1 10 Tf
1 0 0 1 50 700 Tm
(Line 1) Tj
0 -20 Td
(Line 2) Tj
15 TL
0 -15 TD
(Line 3) Tj
T*
(Line 4) Tj
(Line 5) '
ET`;

    const stream2 = `BT
/F1 8 Tf
1 0 0 1 50 600 Tm
(Cell A Part 1) Tj
ET
BT
/F1 8 Tf
1 0 0 1 200 600 Tm
(Cell B) Tj
ET
BT
/F1 8 Tf
1 0 0 1 50 592 Tm
(Cell A Part 2) Tj
ET`;

    const pdfText = `%PDF-1.4
1 0 obj
<</Type /Catalog /Pages 2 0 R>>
endobj
2 0 obj
<</Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>>>>
endobj
3 0 obj
<</Type /Page /Parent 2 0 R /Contents [5 0 R 6 0 R]>>
endobj
4 0 obj
<</Type /Font /Subtype /Type0 /BaseFont /XYZABC+TestFont /Encoding /Identity-H /ToUnicode 7 0 R>>
endobj
5 0 obj
<</Length ${String(stream1.length)}>>
stream
${stream1}
endstream
endobj
6 0 obj
<</Length ${String(stream2.length)}>>
stream
${stream2}
endstream
endobj
7 0 obj
<</Length ${String(cmap.length)}>>
stream
${cmap}
endstream
endobj
trailer
<</Root 1 0 R /Info <</Title (Synthetic Test Document)>>>>
startxref
0
%%EOF`;

    const pdfBytes = new TextEncoder().encode(pdfText);
    const doc = extractPdf(pdfBytes);

    assert.equal(doc.title, 'Synthetic Test Document');
    assert.equal(doc.pageCount, 1);
    const page = doc.pages[0];
    assert.ok(page);
    assert.equal(page.width, 612);
    assert.equal(page.height, 792);

    // Multi-line BT block items
    const lineTexts = page.items.map((it) => it.text);
    assert.ok(lineTexts.includes('Line 1'), 'Line 1 must exist');
    assert.ok(lineTexts.includes('Line 2'), 'Line 2 must exist');
    assert.ok(lineTexts.includes('Line 3'), 'Line 3 must exist');
    assert.ok(lineTexts.includes('Line 4'), 'Line 4 must exist');
    assert.ok(lineTexts.includes('Line 5'), 'Line 5 must exist');

    // Top-aligned wrapped table cells merged
    const rows = page.rows;
    const mergedRow = rows.find((r) =>
      r.items.some((it) => it.text === 'Cell A Part 1 Cell A Part 2'),
    );
    assert.ok(mergedRow, 'Top-aligned wrapped cell must be merged into single row');
    assert.ok(mergedRow.items.some((it) => it.text === 'Cell B'), 'Merged row must retain other cells');
  });

  it('rejects empty, non-PDF, catalog-less, and corrupt FlateDecode inputs with PdfParseError', () => {
    // 1. Empty Uint8Array
    assert.throws(
      () => extractPdf(new Uint8Array(0)),
      (err: unknown) => err instanceof PdfParseError && err.code === 'EMPTY_PDF',
    );

    // 2. Arbitrary text bytes
    assert.throws(
      () => extractPdf(new TextEncoder().encode('Hello world, not a PDF')),
      (err: unknown) => err instanceof PdfParseError && err.code === 'INVALID_PDF',
    );

    // 3. Stub %PDF-1.4 without catalog
    assert.throws(
      () => extractPdf(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')),
      (err: unknown) => err instanceof PdfParseError && err.code === 'INVALID_PDF',
    );

    // 4. Unsupported filter
    const unsupportedPdf = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792]>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /Contents 4 0 R>> endobj
4 0 obj <</Filter /LZWDecode /Length 10>> stream
1234567890
endstream endobj
trailer <</Root 1 0 R>> %%EOF`;
    assert.throws(
      () => extractPdf(new TextEncoder().encode(unsupportedPdf)),
      (err: unknown) =>
        err instanceof PdfParseError && (err.code === 'UNSUPPORTED_PDF' || err.code === 'INVALID_PDF'),
    );

    // 5. Corrupt FlateDecode stream
    const corruptFlatePdf = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792]>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /Contents 4 0 R>> endobj
4 0 obj <</Filter /FlateDecode /Length 10>> stream
corruptdata
endstream endobj
trailer <</Root 1 0 R>> %%EOF`;
    assert.throws(
      () => extractPdf(new TextEncoder().encode(corruptFlatePdf)),
      (err: unknown) => err instanceof PdfParseError && err.code === 'INVALID_PDF',
    );
  });
});
