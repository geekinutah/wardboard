import type { PdfDocument, PdfPage, PdfRow } from '../pdf/index.ts';

export type WithoutCallingsReportErrorCode = 'WRONG_REPORT' | 'COUNT_MISMATCH' | 'UNRECOGNIZED_LAYOUT';

export class WithoutCallingsReportError extends Error {
  readonly code: WithoutCallingsReportErrorCode;
  readonly page: number; // 1-based

  constructor(code: WithoutCallingsReportErrorCode, page: number, message: string) {
    super(message);
    this.name = 'WithoutCallingsReportError';
    this.code = code;
    this.page = page;
  }
}

export type MemberCategory = 'adult' | 'youth';

export interface WithoutCallingsCandidate {
  /** Display name exactly as printed, e.g. 'Kelley, Kaia'. */
  readonly name: string;
  readonly category: MemberCategory;
}

export interface WithoutCallingsReport {
  readonly kind: 'without-callings';
  /** Unit name with the unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the footer as ISO `YYYY-MM-DD`. */
  readonly reportDate: string;
  /** Rows listed in the report (equals the `Count: N` footer). */
  readonly listedCount: number;
  /** Rows dropped because the member is under 11. No names are kept for them. */
  readonly excludedUnder11: number;
  /** Adults and youth in report order. */
  readonly candidates: readonly WithoutCallingsCandidate[];
}

/** The SPEC §15 mapping. Exported so T-057 and the server can share one rule. */
export function categoryForAge(age: number): MemberCategory | 'excluded' {
  if (!Number.isFinite(age) || !Number.isInteger(age) || age < 0) {
    throw new RangeError(`Invalid age: ${String(age)}`);
  }
  if (age >= 18) {
    return 'adult';
  }
  if (age >= 11) {
    return 'youth';
  }
  return 'excluded';
}

const MONTH_MAP: Readonly<Record<string, string>> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

function parseReportDate(raw: string): string | null {
  const trimmed = raw.trim();

  // "Month D, YYYY" or "Mon D, YYYY"
  const m1 = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(trimmed);
  if (m1 && m1[1] && m1[2] && m1[3]) {
    const month = MONTH_MAP[m1[1].toLowerCase()];
    if (!month) return null;
    const day = parseInt(m1[2], 10);
    if (day < 1 || day > 31) return null;
    return `${m1[3]}-${month}-${String(day).padStart(2, '0')}`;
  }

  // "D Mon YYYY" or "D Month YYYY"
  const m2 = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (m2 && m2[1] && m2[2] && m2[3]) {
    const month = MONTH_MAP[m2[2].toLowerCase()];
    if (!month) return null;
    const day = parseInt(m2[1], 10);
    if (day < 1 || day > 31) return null;
    return `${m2[3]}-${month}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

interface ColumnLayout {
  readonly nameX: number;
  readonly genderX: number;
  readonly ageX: number;
  readonly birthDateX: number;
}

function findHeaderRow(page: PdfPage): { row: PdfRow; layout: ColumnLayout } | null {
  for (const row of page.rows) {
    if (row.y < 30 || row.y > 775) continue;

    const nameItem = row.items.find((it) => it.text === 'Name');
    const genderItem = row.items.find((it) => it.text === 'Gender');
    const ageItem = row.items.find((it) => it.text === 'Age');
    const birthDateItem = row.items.find((it) => it.text === 'Birth Date');

    if (nameItem && genderItem && ageItem && birthDateItem) {
      return {
        row,
        layout: {
          nameX: nameItem.x,
          genderX: genderItem.x,
          ageX: ageItem.x,
          birthDateX: birthDateItem.x,
        },
      };
    }
  }
  return null;
}

export function parseWithoutCallingsReport(doc: PdfDocument): WithoutCallingsReport {
  if (doc.title !== 'Members without Callings') {
    throw new WithoutCallingsReportError(
      'WRONG_REPORT',
      1,
      `Expected document title 'Members without Callings', got '${doc.title ?? ''}'`,
    );
  }

  if (doc.pages.length === 0) {
    throw new WithoutCallingsReportError('UNRECOGNIZED_LAYOUT', 1, 'Document contains no pages');
  }

  const page1 = doc.pages[0];
  if (!page1) {
    throw new WithoutCallingsReportError('UNRECOGNIZED_LAYOUT', 1, 'Document contains no pages');
  }

  // Extract unitName from page 1 header (y < 30)
  let unitName: string | null = null;
  for (const row of page1.rows) {
    if (row.y < 30) {
      for (const item of row.items) {
        if (item.text.includes('(')) {
          const candidate = item.text.split('(')[0]?.trim();
          if (candidate) {
            unitName = candidate;
            break;
          }
        }
      }
      if (unitName) break;
    }
  }

  if (!unitName) {
    throw new WithoutCallingsReportError('UNRECOGNIZED_LAYOUT', 1, 'Missing unit name in page 1 header');
  }

  // Extract reportDate from page 1 footer (y > 775)
  let reportDate: string | null = null;
  for (const row of page1.rows) {
    if (row.y > 775) {
      for (const item of row.items) {
        const d = parseReportDate(item.text);
        if (d) {
          reportDate = d;
          break;
        }
      }
      if (reportDate) break;
    }
  }

  if (!reportDate) {
    throw new WithoutCallingsReportError('UNRECOGNIZED_LAYOUT', 1, 'Missing report date in page 1 footer');
  }

  const candidates: WithoutCallingsCandidate[] = [];
  let excludedUnder11 = 0;
  let totalMemberRows = 0;
  let listedCount: number | null = null;

  for (let pageIdx = 0; pageIdx < doc.pages.length; pageIdx++) {
    const page = doc.pages[pageIdx];
    if (!page) continue;
    const pageNum = page.pageNumber;
    const isLastPage = pageIdx === doc.pages.length - 1;

    // Find table header row
    const headerInfo = findHeaderRow(page);

    // If header row is missing on a page that has member rows, throw UNRECOGNIZED_LAYOUT
    if (!headerInfo) {
      const nonCountRows = page.rows.filter(
        (r) => r.y >= 30 && r.y <= 775 && !r.items.some((it) => it.text.includes('Count:')),
      );
      if (nonCountRows.length > 0 || pageNum === 1) {
        throw new WithoutCallingsReportError(
          'UNRECOGNIZED_LAYOUT',
          pageNum,
          `Missing table header row on page ${String(pageNum)}`,
        );
      }
      continue;
    }

    const { row: headerRow, layout } = headerInfo;
    const boundNameGender = (layout.nameX + layout.genderX) / 2;
    const boundGenderAge = (layout.genderX + layout.ageX) / 2;
    const boundAgeBirth = (layout.ageX + layout.birthDateX) / 2;

    for (const row of page.rows) {
      if (row.y < 30 || row.y > 775) continue;
      if (row === headerRow) continue;

      // Check if this row is the Count footer
      const countItem = row.items.find((it) => it.text.includes('Count:'));
      if (countItem) {
        if (!isLastPage) {
          throw new WithoutCallingsReportError(
            'UNRECOGNIZED_LAYOUT',
            pageNum,
            `Unexpected Count footer before last page (page ${String(pageNum)})`,
          );
        }
        const m = /Count:\s*(\d+)/.exec(countItem.text);
        if (m && m[1]) {
          listedCount = parseInt(m[1], 10);
        } else {
          throw new WithoutCallingsReportError(
            'UNRECOGNIZED_LAYOUT',
            pageNum,
            'Invalid Count footer format on last page',
          );
        }
        // Count footer closes table on the last page
        break;
      }

      // Member row: locate name items and age item by column bounds
      const nameItems = row.items.filter((it) => it.x < boundNameGender);
      const name = nameItems.map((it) => it.text).join(' ').trim();
      if (!name) {
        throw new WithoutCallingsReportError(
          'UNRECOGNIZED_LAYOUT',
          pageNum,
          `Missing name in member row on page ${String(pageNum)}`,
        );
      }

      const ageItems = row.items.filter((it) => it.x >= boundGenderAge && it.x < boundAgeBirth);
      const ageText = ageItems.map((it) => it.text).join(' ').trim();
      if (!ageText || !/^\d+$/.test(ageText)) {
        throw new WithoutCallingsReportError(
          'UNRECOGNIZED_LAYOUT',
          pageNum,
          `Missing or invalid age in member row on page ${String(pageNum)}`,
        );
      }

      const age = parseInt(ageText, 10);
      const category = categoryForAge(age);
      if (category === 'excluded') {
        excludedUnder11++;
      } else {
        candidates.push({ name, category });
      }
      totalMemberRows++;
    }
  }

  const lastPageNum = doc.pages[doc.pages.length - 1]?.pageNumber ?? doc.pages.length;

  if (listedCount === null) {
    throw new WithoutCallingsReportError(
      'UNRECOGNIZED_LAYOUT',
      lastPageNum,
      'Missing Count footer on last page',
    );
  }

  if (totalMemberRows !== listedCount) {
    throw new WithoutCallingsReportError(
      'COUNT_MISMATCH',
      lastPageNum,
      `Row count ${String(totalMemberRows)} does not match listed count ${String(listedCount)}`,
    );
  }

  return {
    kind: 'without-callings',
    unitName,
    reportDate,
    listedCount,
    excludedUnder11,
    candidates,
  };
}
