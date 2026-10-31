import type { PdfDocument, PdfPage, PdfRow, PdfTextItem } from '../pdf/index.ts';
import { categoryForAge, type MemberCategory, type MemberGender } from './without-callings.ts';

export interface MemberListEntry {
  readonly name: string;
  readonly category: MemberCategory;
  readonly gender: MemberGender;
}

export interface MemberListReport {
  readonly kind: 'member-list';
  /** Unit name with the unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** ISO date when the footer prints one, otherwise null. */
  readonly reportDate: string | null;
  /** Rows listed in the report (equals the printed count). */
  readonly listedCount: number;
  /** Rows dropped because the member is under 11. No names are kept for them. */
  readonly excludedUnder11: number;
  /** Adults and youth in report order. Namesakes stay separate rows. */
  readonly entries: readonly MemberListEntry[];
}

export class MemberListReportError extends Error {
  readonly code: 'UNRECOGNIZED_LAYOUT' | 'COUNT_MISMATCH' | 'INVALID_AGE';
  readonly page: number;

  constructor(
    code: 'UNRECOGNIZED_LAYOUT' | 'COUNT_MISMATCH' | 'INVALID_AGE',
    page: number,
    message: string,
  ) {
    super(message);
    this.name = 'MemberListReportError';
    this.code = code;
    this.page = page;
  }
}

const HEADINGS = ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number', 'Email'] as const;

const MONTHS: Readonly<Record<string, string>> = {
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

interface HeaderLayout {
  readonly row: PdfRow;
  readonly nameEnd: number;
  readonly genderEnd: number;
  readonly ageEnd: number;
}

function layoutError(page: number, message: string): MemberListReportError {
  return new MemberListReportError('UNRECOGNIZED_LAYOUT', page, message);
}

function ageError(page: number): MemberListReportError {
  return new MemberListReportError(
    'INVALID_AGE',
    page,
    `Invalid age in the Age column on page ${String(page)}`,
  );
}

function isoDateIn(text: string): string | null {
  for (const match of text.matchAll(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/g)) {
    const dayText = match[1];
    const monthText = match[2];
    const yearText = match[3];
    if (!dayText || !monthText || !yearText) continue;
    const month = MONTHS[monthText.toLowerCase()];
    if (!month) continue;
    const day = Number(dayText);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    return `${yearText}-${month}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function pageItems(page: PdfPage): readonly PdfTextItem[] {
  if (page.items.length > 0) return page.items;
  return page.rows.flatMap((row) => row.items);
}

function findHeader(page: PdfPage): HeaderLayout | null {
  for (const row of page.rows) {
    if (row.items.length !== HEADINGS.length) continue;
    const xs: number[] = [];
    let matches = true;
    for (let index = 0; index < HEADINGS.length; index += 1) {
      const item = row.items[index];
      if (!item || item.text !== HEADINGS[index]) {
        matches = false;
        break;
      }
      xs.push(item.x);
    }
    if (!matches) continue;
    const nameX = xs[0];
    const genderX = xs[1];
    const ageX = xs[2];
    const birthX = xs[3];
    const phoneX = xs[4];
    const emailX = xs[5];
    if (
      nameX === undefined ||
      genderX === undefined ||
      ageX === undefined ||
      birthX === undefined ||
      phoneX === undefined ||
      emailX === undefined ||
      !(nameX < genderX && genderX < ageX && ageX < birthX && birthX < phoneX && phoneX < emailX)
    ) {
      continue;
    }
    return {
      row,
      nameEnd: (nameX + genderX) / 2,
      genderEnd: (genderX + ageX) / 2,
      ageEnd: (ageX + birthX) / 2,
    };
  }
  return null;
}

function hasTitle(page: PdfPage, headerY: number): boolean {
  return pageItems(page).some((item) => item.y < headerY && item.text.trim() === 'Member List');
}

function findUnitName(page: PdfPage, headerY: number): string | null {
  for (const item of pageItems(page)) {
    if (item.y >= headerY) continue;
    const match = /^(.+?)\s+\(\d+\)$/.exec(item.text.trim());
    const name = match?.[1]?.trim();
    if (!name || name.endsWith('Stake')) continue;
    return name;
  }
  return null;
}

function findReportDate(doc: PdfDocument): string | null {
  for (const page of doc.pages) {
    for (const row of page.rows) {
      for (const item of row.items) {
        if (!item.text.includes('For Church Use Only')) continue;
        const iso = isoDateIn(item.text);
        if (iso) return iso;
      }
    }
  }
  return null;
}

function isFooter(row: PdfRow): boolean {
  return row.items.some((item) => item.text.includes('For Church Use Only'));
}

function cellText(row: PdfRow, start: number, end: number): string {
  const parts: string[] = [];
  for (const item of row.items) {
    if (item.x >= start && item.x < end) parts.push(item.text);
  }
  return parts.join(' ').trim();
}

function readCount(row: PdfRow, page: number): number | null {
  const text = row.items.map((item) => item.text).join(' ').trim();
  if (!text.startsWith('Count:')) return null;
  const match = /^Count:\s*(\d+)$/.exec(text);
  const countText = match?.[1];
  if (!countText) {
    throw layoutError(page, `Invalid count on page ${String(page)}`);
  }
  return Number(countText);
}

function categoryFromAgeText(ageText: string, page: number): MemberCategory | 'excluded' {
  if (!/^\d+$/.test(ageText)) throw ageError(page);
  try {
    return categoryForAge(Number(ageText));
  } catch (err: unknown) {
    if (err instanceof RangeError) throw ageError(page);
    throw err;
  }
}

export function parseMemberList(doc: PdfDocument): MemberListReport {
  const page1 = doc.pages[0];
  if (!page1) {
    throw layoutError(1, 'Missing Member List title on page 1');
  }
  const header1 = findHeader(page1);
  const printedTitle = header1
    ? hasTitle(page1, header1.row.y)
    : pageItems(page1).some((item) => item.text.trim() === 'Member List');
  if (!printedTitle) {
    throw layoutError(1, 'Missing Member List title on page 1');
  }
  if (!header1) {
    throw layoutError(1, 'Missing column headings on page 1');
  }
  const unitName = findUnitName(page1, header1.row.y);
  if (!unitName) {
    throw layoutError(1, 'Missing unit name on page 1');
  }

  const entries: MemberListEntry[] = [];
  let excludedUnder11 = 0;
  let totalMemberRows = 0;
  let listedCount: number | null = null;
  let countPage = page1.pageNumber;

  for (const [index, page] of doc.pages.entries()) {
    const isLast = index === doc.pages.length - 1;
    const header = index === 0 ? header1 : findHeader(page);
    if (!header) {
      throw layoutError(page.pageNumber, `Missing column headings on page ${String(page.pageNumber)}`);
    }
    let closed = false;
    for (const row of page.rows) {
      if (row.y <= header.row.y) continue;
      if (isFooter(row)) continue;
      if (closed) {
        throw layoutError(page.pageNumber, `Unexpected row after the count on page ${String(page.pageNumber)}`);
      }
      const count = readCount(row, page.pageNumber);
      if (count !== null) {
        if (!isLast || listedCount !== null) {
          throw layoutError(page.pageNumber, `Unexpected count on page ${String(page.pageNumber)}`);
        }
        listedCount = count;
        countPage = page.pageNumber;
        closed = true;
        continue;
      }

      // Birth date, phone, and email are column positions only. Their text is not kept.
      const name = cellText(row, Number.NEGATIVE_INFINITY, header.nameEnd);
      const genderText = cellText(row, header.nameEnd, header.genderEnd);
      const ageText = cellText(row, header.genderEnd, header.ageEnd);
      if (name.length === 0 && ageText.length === 0) {
        throw layoutError(page.pageNumber, `Unrecognized row on page ${String(page.pageNumber)}`);
      }
      if (name.length === 0) {
        throw layoutError(page.pageNumber, `Missing name on page ${String(page.pageNumber)}`);
      }
      if (genderText !== 'M' && genderText !== 'F') {
        throw layoutError(
          page.pageNumber,
          `Invalid gender in the Gender column on page ${String(page.pageNumber)}`,
        );
      }
      const gender: MemberGender = genderText;
      const category = categoryFromAgeText(ageText, page.pageNumber);
      totalMemberRows += 1;
      if (category === 'excluded') {
        excludedUnder11 += 1;
      } else {
        entries.push({ name, category, gender });
      }
    }
  }

  const lastPage = doc.pages[doc.pages.length - 1]?.pageNumber ?? page1.pageNumber;
  if (listedCount === null) {
    throw layoutError(lastPage, `Missing count on page ${String(lastPage)}`);
  }
  if (listedCount !== totalMemberRows) {
    throw new MemberListReportError(
      'COUNT_MISMATCH',
      countPage,
      `Row count does not match the printed count on page ${String(countPage)}`,
    );
  }

  return {
    kind: 'member-list',
    unitName,
    reportDate: findReportDate(doc),
    listedCount,
    excludedUnder11,
    entries,
  };
}
