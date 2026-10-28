import type { PdfDocument, PdfTextItem } from '../pdf/index.ts';

export type OutOfUnitReportErrorCode =
  | 'WRONG_REPORT'
  | 'COUNT_MISMATCH'
  | 'UNRECOGNIZED_LAYOUT';

export class OutOfUnitReportError extends Error {
  readonly code: OutOfUnitReportErrorCode;
  readonly page: number; // 1-based

  constructor(code: OutOfUnitReportErrorCode, page: number, message: string) {
    super(message);
    this.name = 'OutOfUnitReportError';
    this.code = code;
    this.page = page;
  }
}

export type OutOfUnitSection = 'stake' | 'serving-outside-unit' | 'living-outside-unit';

export interface ExternalCallingRecord {
  readonly section: OutOfUnitSection;
  /** Display name exactly as printed, e.g. 'Melford, Leo'. */
  readonly name: string;
  /** Calling title exactly as printed. */
  readonly calling: string;
  /** 'Serving in Unit' value for 'serving-outside-unit' (e.g. 'Cedar Peak Utah Temple'); null for 'stake' and 'living-outside-unit'. */
  readonly servingUnit: string | null;
}

export interface OutOfUnitReport {
  readonly kind: 'out-of-unit';
  /** Unit name with the unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the footer as ISO `YYYY-MM-DD`. */
  readonly reportDate: string;
  /** Report order: Stake Callings rows, then Serving outside of assigned unit rows, then Living outside of Unit rows. */
  readonly externalCallings: readonly ExternalCallingRecord[];
}

const SECTION_HEADERS: Record<string, OutOfUnitSection> = {
  'Stake Callings': 'stake',
  'Serving outside of assigned unit': 'serving-outside-unit',
  'Living outside of Unit': 'living-outside-unit',
};

const EXPECTED_COLUMNS: Record<OutOfUnitSection, readonly string[]> = {
  stake: ['Calling', 'Name', 'Sustained'],
  'serving-outside-unit': ['Serving in Unit', 'Calling', 'Name', 'Sustained'],
  'living-outside-unit': ['Calling', 'Name', 'Sustained'],
};

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function extractUnitName(items: readonly PdfTextItem[]): string | null {
  for (const item of items) {
    const text = item.text.trim();
    if (text === 'Out-of-Unit Callings') continue;
    const match = text.match(/^(.+?)\s*\(\d+\)$/);
    if (match && match[1]) {
      const name = match[1].trim();
      if (!name.endsWith('Stake')) {
        return name;
      }
    }
  }
  for (const item of items) {
    const text = item.text.trim();
    if (text === 'Out-of-Unit Callings') continue;
    if (text.endsWith('Stake')) continue;
    if (text.length > 0) {
      return text.replace(/\s*\(\d+\)\s*$/, '').trim();
    }
  }
  return null;
}

function extractReportDate(items: readonly PdfTextItem[]): string | null {
  for (const item of items) {
    const text = item.text.trim();
    // "25 Oct 2026" or "5 October 2026"
    const dMonY = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dMonY && dMonY[1] && dMonY[2] && dMonY[3]) {
      const month = MONTH_MAP[dMonY[2].toLowerCase()];
      if (month) {
        const day = dMonY[1].padStart(2, '0');
        const year = dMonY[3];
        return `${year}-${month}-${day}`;
      }
    }
    // "October 25, 2026" or "Oct 25, 2026"
    const monDY = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (monDY && monDY[1] && monDY[2] && monDY[3]) {
      const month = MONTH_MAP[monDY[1].toLowerCase()];
      if (month) {
        const day = monDY[2].padStart(2, '0');
        const year = monDY[3];
        return `${year}-${month}-${day}`;
      }
    }
  }
  return null;
}

export function parseOutOfUnitReport(doc: PdfDocument): OutOfUnitReport {
  if (doc.title !== 'Out-of-Unit Callings') {
    const actualTitle = doc.title ?? '';
    throw new OutOfUnitReportError(
      'WRONG_REPORT',
      1,
      `Expected document title "Out-of-Unit Callings", received "${actualTitle}"`,
    );
  }

  const page1 = doc.pages[0];
  if (!page1) {
    throw new OutOfUnitReportError('UNRECOGNIZED_LAYOUT', 1, 'Document contains no pages');
  }

  const headerItems = page1.rows.filter((r) => r.y < 30).flatMap((r) => r.items);
  const footerItems = page1.rows.filter((r) => r.y > 770).flatMap((r) => r.items);

  const unitName = extractUnitName(headerItems);
  if (!unitName) {
    throw new OutOfUnitReportError('UNRECOGNIZED_LAYOUT', 1, 'Missing unit name in header');
  }

  const reportDate = extractReportDate(footerItems);
  if (!reportDate) {
    throw new OutOfUnitReportError('UNRECOGNIZED_LAYOUT', 1, 'Missing report date in footer');
  }

  let currentSection: OutOfUnitSection | null = null;
  let currentSectionTitle: string | null = null;
  let awaitingHeaderFor: OutOfUnitSection | null = null;
  let boundaries: number[] = [];
  const seenSections = new Set<OutOfUnitSection>();
  const stakeRecords: ExternalCallingRecord[] = [];
  const servingRecords: ExternalCallingRecord[] = [];
  const livingRecords: ExternalCallingRecord[] = [];
  let sectionRowCount = 0;

  for (const page of doc.pages) {
    const bodyRows = page.rows.filter((r) => r.y >= 30 && r.y <= 770);

    for (const row of bodyRows) {
      const rowText = row.items
        .map((it) => it.text.trim())
        .filter(Boolean)
        .join(' ');
      if (!rowText) continue;

      if (awaitingHeaderFor !== null) {
        const expected = EXPECTED_COLUMNS[awaitingHeaderFor];
        const items = row.items;
        const allBold = items.length > 0 && items.every((it) => it.bold);
        const matchesCols =
          items.length === expected.length &&
          items.every((it, idx) => it.text.trim() === expected[idx]);

        if (!allBold || !matchesCols) {
          const title = currentSectionTitle ?? '';
          throw new OutOfUnitReportError(
            'UNRECOGNIZED_LAYOUT',
            page.pageNumber,
            `Expected bold column header row for "${title}"`,
          );
        }

        boundaries = [];
        for (let i = 0; i < items.length - 1; i++) {
          const left = items[i];
          const right = items[i + 1];
          if (left && right) {
            boundaries.push((left.x + right.x) / 2);
          }
        }

        currentSection = awaitingHeaderFor;
        awaitingHeaderFor = null;
        sectionRowCount = 0;
        continue;
      }

      if (currentSection !== null) {
        const countMatch = rowText.match(/^Count:\s*(\d+)$/);
        if (countMatch && countMatch[1]) {
          const expectedCount = parseInt(countMatch[1], 10);

          if (sectionRowCount !== expectedCount) {
            const title = currentSectionTitle ?? '';
            throw new OutOfUnitReportError(
              'COUNT_MISMATCH',
              page.pageNumber,
              `Row count (${String(sectionRowCount)}) does not match expected count (${String(expectedCount)}) in ${title}`,
            );
          }

          currentSection = null;
          currentSectionTitle = null;
          boundaries = [];
          sectionRowCount = 0;
          continue;
        }

        if (SECTION_HEADERS[rowText] !== undefined) {
          const title = currentSectionTitle ?? '';
          throw new OutOfUnitReportError(
            'UNRECOGNIZED_LAYOUT',
            page.pageNumber,
            `Encountered section header "${rowText}" before closing "${title}" with Count`,
          );
        }

        const cells: string[] = boundaries.map(() => '');
        cells.push('');

        for (const item of row.items) {
          const text = item.text.trim();
          if (!text) continue;
          let colIdx = 0;
          let b = boundaries[colIdx];
          while (b !== undefined && item.x >= b) {
            colIdx++;
            b = boundaries[colIdx];
          }
          const existing = cells[colIdx];
          cells[colIdx] = existing ? `${existing} ${text}` : text;
        }

        if (currentSection === 'stake') {
          const calling = cells[0]?.trim();
          const name = cells[1]?.trim();
          if (!calling || !name) {
            throw new OutOfUnitReportError(
              'UNRECOGNIZED_LAYOUT',
              page.pageNumber,
              'Malformed data row in Stake Callings',
            );
          }
          stakeRecords.push({
            section: 'stake',
            name,
            calling,
            servingUnit: null,
          });
          sectionRowCount++;
        } else if (currentSection === 'serving-outside-unit') {
          const servingUnit = cells[0]?.trim();
          const calling = cells[1]?.trim();
          const name = cells[2]?.trim();
          if (!servingUnit || !calling || !name) {
            throw new OutOfUnitReportError(
              'UNRECOGNIZED_LAYOUT',
              page.pageNumber,
              'Malformed data row in Serving outside of assigned unit',
            );
          }
          servingRecords.push({
            section: 'serving-outside-unit',
            name,
            calling,
            servingUnit,
          });
          sectionRowCount++;
        } else {
          // currentSection is 'living-outside-unit'
          const calling = cells[0]?.trim();
          const name = cells[1]?.trim();
          if (!calling || !name) {
            throw new OutOfUnitReportError(
              'UNRECOGNIZED_LAYOUT',
              page.pageNumber,
              'Malformed data row in Living outside of Unit',
            );
          }
          livingRecords.push({
            section: 'living-outside-unit',
            name,
            calling,
            servingUnit: null,
          });
          sectionRowCount++;
        }
        continue;
      }

      const sectionType = SECTION_HEADERS[rowText];
      if (sectionType === undefined) {
        throw new OutOfUnitReportError(
          'UNRECOGNIZED_LAYOUT',
          page.pageNumber,
          `Unexpected row or unrecognized section header: "${rowText}"`,
        );
      }

      if (seenSections.has(sectionType)) {
        throw new OutOfUnitReportError(
          'UNRECOGNIZED_LAYOUT',
          page.pageNumber,
          `Duplicate section header: "${rowText}"`,
        );
      }

      seenSections.add(sectionType);
      awaitingHeaderFor = sectionType;
      currentSectionTitle = rowText;
    }
  }

  if (awaitingHeaderFor !== null || currentSection !== null) {
    const lastPage = doc.pages.length > 0 ? doc.pages.length : 1;
    throw new OutOfUnitReportError(
      'UNRECOGNIZED_LAYOUT',
      lastPage,
      'Incomplete section at end of document',
    );
  }

  if (
    !seenSections.has('stake') ||
    !seenSections.has('serving-outside-unit') ||
    !seenSections.has('living-outside-unit')
  ) {
    throw new OutOfUnitReportError(
      'UNRECOGNIZED_LAYOUT',
      1,
      'Document is missing required sections',
    );
  }

  return {
    kind: 'out-of-unit',
    unitName,
    reportDate,
    externalCallings: [...stakeRecords, ...servingRecords, ...livingRecords],
  };
}
