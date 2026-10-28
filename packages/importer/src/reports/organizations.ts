import type { PdfDocument, PdfRow } from '../pdf/index.ts';

export type OrganizationsReportErrorCode = 'WRONG_REPORT' | 'COUNT_MISMATCH' | 'UNRECOGNIZED_LAYOUT';

export class OrganizationsReportError extends Error {
  readonly code: OrganizationsReportErrorCode;
  /** 1-based page where the problem was detected. */
  readonly page: number;

  constructor(code: OrganizationsReportErrorCode, page: number, message: string) {
    super(message);
    this.name = 'OrganizationsReportError';
    this.code = code;
    this.page = page;
  }
}

export interface OrganizationsReport {
  readonly kind: 'organizations';
  /** Unit name from the page header with the parenthesized unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the page footer as ISO `YYYY-MM-DD`, e.g. '2026-10-25'. */
  readonly reportDate: string;
  readonly organizations: readonly ReportOrganization[];
}

export interface ReportOrganization {
  readonly name: string; // e.g. 'Elders Quorum'
  readonly groups: readonly ReportGroup[]; // document order
}

export interface ReportGroup {
  /** Bold group heading, e.g. 'Teachers', 'Valiant 10, Valiant 9'. When an organization's calling table follows its organization heading directly (Bishopric, Ward Missionaries, Temple and Family History, Young Single Adult), the group name equals the organization name. */
  readonly name: string;
  readonly positions: readonly ReportPosition[]; // table row order
}

export interface ReportPosition {
  /** Calling title with any leading custom marker '* ' removed. */
  readonly title: string;
  /** True when the row's title begins with the report's custom-calling marker '* '. */
  readonly custom: boolean;
  /** Display name exactly as printed ('Last, First Middle'), or null when the row is the italic 'Calling Vacant' marker. */
  readonly occupant: string | null;
}

const MONTH_MAP: Readonly<Record<string, string>> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function parseFooterDate(text: string): string | null {
  const trimmed = text.trim();
  // Format: D Mon YYYY (e.g. 25 Oct 2026)
  const dMonYear = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (dMonYear?.[1] && dMonYear[2] && dMonYear[3]) {
    const month = MONTH_MAP[dMonYear[2].toLowerCase()];
    if (month) {
      return `${dMonYear[3]}-${month}-${dMonYear[1].padStart(2, '0')}`;
    }
  }

  // Format: Month D, YYYY (e.g. October 25, 2026)
  const monthDYear = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(trimmed);
  if (monthDYear?.[1] && monthDYear[2] && monthDYear[3]) {
    const month = MONTH_MAP[monthDYear[1].toLowerCase()];
    if (month) {
      return `${monthDYear[3]}-${month}-${monthDYear[2].padStart(2, '0')}`;
    }
  }

  return null;
}

interface PageRowEntry {
  readonly page: number;
  readonly row: PdfRow;
}

function isFootnoteRow(row: PdfRow): boolean {
  if (row.items.length === 1) {
    const text = row.items[0]?.text ?? '';
    if (
      text.startsWith('* custom calling') ||
      text.startsWith('** Unbaptized') ||
      text.startsWith('* out of default') ||
      (text.startsWith('*') && !text.startsWith('* '))
    ) {
      return true;
    }
  }
  return false;
}

function isCallingTableHeader(row: PdfRow): boolean {
  const first = row.items[0];
  return (
    first?.bold === true &&
    first.text === 'Calling' &&
    row.items.some((it) => it.bold && it.text === 'Name')
  );
}

function isRosterTableHeader(row: PdfRow): boolean {
  const first = row.items[0];
  return (
    first?.bold === true &&
    first.text === 'Name' &&
    !isCallingTableHeader(row)
  );
}

function isCountRow(row: PdfRow): boolean {
  return row.items[0]?.text.startsWith('Count:') ?? false;
}

function isHeadingRow(row: PdfRow, callingMarginX: number): boolean {
  if (isCallingTableHeader(row) || isRosterTableHeader(row) || isCountRow(row) || isFootnoteRow(row)) {
    return false;
  }
  const first = row.items[0];
  if (!first) return false;
  if (Math.abs(first.x - callingMarginX) > 2.0) return false;

  if (row.items.length === 1) {
    return !first.text.startsWith('*');
  }
  if (row.items.length === 2 && row.items[1]?.text.startsWith('Room:')) {
    return true;
  }
  return false;
}

interface ActiveCallingTable {
  readonly type: 'calling';
  readonly groupName: string;
  readonly positions: ReportPosition[];
  rowCount: number;
}

interface ActiveRosterTable {
  readonly type: 'roster';
  readonly groupName: string;
  rowCount: number;
}

type ActiveTable = ActiveCallingTable | ActiveRosterTable;

interface MutableOrganization {
  readonly name: string;
  readonly groups: ReportGroup[];
}

export function parseOrganizationsReport(doc: PdfDocument): OrganizationsReport {
  // 1. Report identity
  if (doc.title !== 'Organizations and Callings') {
    throw new OrganizationsReportError('WRONG_REPORT', 1, 'Expected title "Organizations and Callings"');
  }

  const p1 = doc.pages[0];
  if (!p1) {
    throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', 1, 'Document has no pages');
  }

  // 2. Unit name and report date from page 1 furniture
  let unitName: string | null = null;
  for (const item of p1.items) {
    if (item.y < 30) {
      const match = /^(.+?) \(\d+\)$/.exec(item.text);
      if (match?.[1] && !/Stake \(\d+\)$/.test(item.text)) {
        unitName = match[1].trim();
        break;
      }
    }
  }
  if (!unitName) {
    throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', 1, 'Could not determine unit name from page 1 header');
  }

  let reportDate: string | null = null;
  for (const item of p1.items) {
    if (item.y > 775) {
      const parsed = parseFooterDate(item.text);
      if (parsed) {
        reportDate = parsed;
        break;
      }
    }
  }
  if (!reportDate) {
    throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', 1, 'Could not determine report date from page 1 footer');
  }

  // Collect non-furniture rows
  const nonFurnitureRows: PageRowEntry[] = [];
  for (const page of doc.pages) {
    for (const row of page.rows) {
      if (row.y < 30 || row.y > 775) continue;
      nonFurnitureRows.push({ page: page.pageNumber, row });
    }
  }

  // Determine left margin from first Calling header
  let callingMarginX = 35.25;
  for (const { row } of nonFurnitureRows) {
    const first = row.items[0];
    if (first?.text === 'Calling' && first.bold) {
      callingMarginX = first.x;
      break;
    }
  }

  const organizations: MutableOrganization[] = [];
  let currentOrg: MutableOrganization | null = null;
  let pendingGroupName: string | null = null;
  let activeTable: ActiveTable | null = null;

  for (let i = 0; i < nonFurnitureRows.length; i++) {
    const entry = nonFurnitureRows[i];
    if (!entry) continue;
    const { page, row } = entry;

    if (isFootnoteRow(row)) {
      continue;
    }

    if (activeTable !== null) {
      if (isCountRow(row)) {
        const first = row.items[0];
        const match = /^Count:\s*(\d+)$/.exec(first?.text ?? '');
        if (!match?.[1]) {
          throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Invalid Count footer format');
        }
        const expectedCount = parseInt(match[1], 10);
        if (activeTable.rowCount !== expectedCount) {
          const targetName = activeTable.type === 'calling' ? activeTable.groupName : 'member roster';
          throw new OrganizationsReportError(
            'COUNT_MISMATCH',
            page,
            `Count mismatch in ${targetName}: expected ${String(expectedCount)}, got ${String(activeTable.rowCount)}`,
          );
        }

        if (activeTable.type === 'calling') {
          if (!currentOrg) {
            throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Calling table closed without an organization');
          }
          currentOrg.groups.push({
            name: activeTable.groupName,
            positions: activeTable.positions,
          });
        }

        activeTable = null;
        continue;
      }

      if (activeTable.type === 'calling' && isCallingTableHeader(row)) {
        // Continued table header across page break
        continue;
      }

      if (activeTable.type === 'roster' && isRosterTableHeader(row)) {
        // Continued roster header across page break
        continue;
      }

      if (isHeadingRow(row, callingMarginX)) {
        // Table was left unclosed before next section
        throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Table was not closed before next section');
      }

      if (activeTable.type === 'roster') {
        activeTable.rowCount++;
        continue;
      }

      // Inside calling table
      if (row.items.length < 2) {
        throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Calling row is missing occupant');
      }

      const titleItem = row.items[0];
      const occupantItem = row.items[1];
      if (!titleItem || !occupantItem) {
        throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Calling row is missing title or occupant');
      }

      let title = titleItem.text;
      let custom = false;
      if (title.startsWith('* ')) {
        custom = true;
        title = title.slice(2);
      }

      const occupant = occupantItem.text === 'Calling Vacant' ? null : occupantItem.text;
      activeTable.positions.push({
        title,
        custom,
        occupant,
      });
      activeTable.rowCount++;
      continue;
    }

    // Outside any table
    if (isHeadingRow(row, callingMarginX)) {
      // Look ahead to next non-furniture, non-footnote row
      let nextRow: PdfRow | null = null;
      for (let j = i + 1; j < nonFurnitureRows.length; j++) {
        const nextCandidate = nonFurnitureRows[j]?.row;
        if (nextCandidate && !isFootnoteRow(nextCandidate)) {
          nextRow = nextCandidate;
          break;
        }
      }

      const firstItem = row.items[0];
      if (!firstItem) {
        throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Heading row has no items');
      }
      const headingText = firstItem.text.trim();
      const isBold = firstItem.bold;

      if (nextRow && isRosterTableHeader(nextRow)) {
        // Starts a member-roster section (dropped)
        continue;
      } else if (!isBold) {
        // Starts a new organization
        currentOrg = { name: headingText, groups: [] };
        organizations.push(currentOrg);
        pendingGroupName = null;
      } else {
        // Bold group heading
        if (!currentOrg) {
          throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Group heading found without an organization');
        }
        pendingGroupName = headingText;
      }
      continue;
    }

    if (isCallingTableHeader(row)) {
      if (!currentOrg) {
        throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Calling table found without an active organization');
      }
      const groupName = pendingGroupName ?? currentOrg.name;
      pendingGroupName = null;
      activeTable = {
        type: 'calling',
        groupName,
        positions: [],
        rowCount: 0,
      };
      continue;
    }

    if (isRosterTableHeader(row)) {
      activeTable = {
        type: 'roster',
        groupName: 'member roster',
        rowCount: 0,
      };
      continue;
    }

    // Any other row outside any table is unrecognized
    throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', page, 'Data row outside any table');
  }

  if (activeTable !== null) {
    const lastPage = doc.pages[doc.pages.length - 1]?.pageNumber ?? 1;
    throw new OrganizationsReportError('UNRECOGNIZED_LAYOUT', lastPage, 'Table was not closed by Count footer');
  }

  return {
    kind: 'organizations',
    unitName,
    reportDate,
    organizations,
  };
}
