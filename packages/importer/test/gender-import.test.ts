import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  ImportBundle,
  MemberListEntry,
  PdfDocument,
  PdfPage,
  PdfRow,
  PdfTextItem,
  WithoutCallingsCandidate,
} from '../src/index.ts';
import {
  AllowListError,
  allowListImport,
  allowListMemberList,
  extractPdf,
  MemberListReportError,
  parseMemberList,
  parseWithoutCallingsReport,
  reconcile,
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

const COLUMN_X = {
  name: 36,
  gender: 182.4,
  age: 220,
  birth: 260,
  phone: 340,
  email: 430,
};

function textItem(text: string, x: number, y: number, bold = false): PdfTextItem {
  return {
    text,
    x,
    y,
    fontSize: 8.5,
    fontName: bold ? 'Calibri-Bold' : 'Calibri',
    bold,
    italic: false,
  };
}

function rowOf(y: number, items: readonly PdfTextItem[]): PdfRow {
  return { y, items };
}

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

function emptyBundle(): ImportBundle {
  return {
    organizations: {
      kind: 'organizations',
      unitName: 'Cedar 14th Ward',
      reportDate: '2026-10-25',
      organizations: [],
    },
    withoutCallings: {
      kind: 'without-callings',
      unitName: 'Cedar 14th Ward',
      reportDate: '2026-10-25',
      listedCount: 0,
      excludedUnder11: 0,
      candidates: [],
    },
    outOfUnit: {
      kind: 'out-of-unit',
      unitName: 'Cedar 14th Ward',
      reportDate: '2026-10-25',
      externalCallings: [],
    },
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

describe('T-115: Member gender import and reconciliation', () => {
  const withoutCallingsDoc = extractPdf(loadFixture('members-without-callings.pdf'));
  const memberListDoc = extractPdf(loadFixture('member-list.pdf'));

  it('without-callings and member-list parsers extract M and F genders from the fixtures', () => {
    const withoutCallings = parseWithoutCallingsReport(withoutCallingsDoc);
    expect(withoutCallings.candidates.length).toBeGreaterThan(0);
    const wcGenders = new Set(withoutCallings.candidates.map((c) => c.gender));
    expect(wcGenders.has('M')).toBe(true);
    expect(wcGenders.has('F')).toBe(true);
    for (const c of withoutCallings.candidates) {
      expect(['M', 'F']).toContain(c.gender);
    }

    const memberList = parseMemberList(memberListDoc);
    expect(memberList.entries.length).toBeGreaterThan(0);
    const mlGenders = new Set(memberList.entries.map((e) => e.gender));
    expect(mlGenders.has('M')).toBe(true);
    expect(mlGenders.has('F')).toBe(true);
    for (const e of memberList.entries) {
      expect(['M', 'F']).toContain(e.gender);
    }
  });

  it("parsers reject an invalid gender cell without leaking the person's name", () => {
    // 1. without-callings with invalid gender 'X'
    {
      const modified = cloneDoc(withoutCallingsDoc);
      const p1 = modified.pages[0] as PdfPage;
      const headerRow = p1.rows.find((r) => r.items.some((it) => it.text === 'Name'));
      assert.ok(headerRow);
      const memberRow = p1.rows.find(
        (r) => r.y > headerRow.y && r.y < 775 && !r.items.some((it) => it.text.includes('Count:')),
      );
      assert.ok(memberRow);
      const name = memberRow.items[0]?.text ?? 'Kelley, Kaia';
      // Find gender item (item between name and age)
      const genderItem = memberRow.items.find((it) => it.text === 'M' || it.text === 'F');
      assert.ok(genderItem);
      (genderItem as { text: string }).text = 'X';

      expect(() => parseWithoutCallingsReport(modified)).toThrow(WithoutCallingsReportError);
      try {
        parseWithoutCallingsReport(modified);
      } catch (err: unknown) {
        assert.ok(err instanceof WithoutCallingsReportError);
        expect(err.code).toBe('UNRECOGNIZED_LAYOUT');
        expect(err.message).not.toContain(name);
      }
    }

    // 2. without-callings with empty gender cell
    {
      const modified = cloneDoc(withoutCallingsDoc);
      const p1 = modified.pages[0] as PdfPage;
      const headerRow = p1.rows.find((r) => r.items.some((it) => it.text === 'Name'));
      assert.ok(headerRow);
      const memberRow = p1.rows.find(
        (r) => r.y > headerRow.y && r.y < 775 && !r.items.some((it) => it.text.includes('Count:')),
      );
      assert.ok(memberRow);
      const name = memberRow.items[0]?.text ?? 'Kelley, Kaia';
      (memberRow.items as PdfTextItem[]) = memberRow.items.filter((it) => it.text !== 'M' && it.text !== 'F');

      expect(() => parseWithoutCallingsReport(modified)).toThrow(WithoutCallingsReportError);
      try {
        parseWithoutCallingsReport(modified);
      } catch (err: unknown) {
        assert.ok(err instanceof WithoutCallingsReportError);
        expect(err.code).toBe('UNRECOGNIZED_LAYOUT');
        expect(err.message).not.toContain(name);
      }
    }

    // 3. member-list with invalid gender 'X'
    {
      const doc = builtMemberList(
        [{ name: 'SecretName, Leaked', gender: 'X', age: '25' }],
        1,
      );
      expect(() => parseMemberList(doc)).toThrow(MemberListReportError);
      try {
        parseMemberList(doc);
      } catch (err: unknown) {
        assert.ok(err instanceof MemberListReportError);
        expect(err.code).toBe('UNRECOGNIZED_LAYOUT');
        expect(err.message).not.toContain('SecretName');
        expect(err.message).not.toContain('Leaked');
      }
    }

    // 4. member-list with empty gender ''
    {
      const doc = builtMemberList(
        [{ name: 'SecretName, EmptyGender', gender: '', age: '25' }],
        1,
      );
      expect(() => parseMemberList(doc)).toThrow(MemberListReportError);
      try {
        parseMemberList(doc);
      } catch (err: unknown) {
        assert.ok(err instanceof MemberListReportError);
        expect(err.code).toBe('UNRECOGNIZED_LAYOUT');
        expect(err.message).not.toContain('SecretName');
      }
    }

    // 5. member-list with under-11 row with invalid gender
    {
      const doc = builtMemberList(
        [{ name: 'Child, UnderEleven', gender: 'INVALID', age: '9' }],
        1,
      );
      expect(() => parseMemberList(doc)).toThrow(MemberListReportError);
      try {
        parseMemberList(doc);
      } catch (err: unknown) {
        assert.ok(err instanceof MemberListReportError);
        expect(err.code).toBe('UNRECOGNIZED_LAYOUT');
        expect(err.message).not.toContain('Child');
      }
    }
  });

  it('allow-list keeps gender and rejects a gender other than M or F', () => {
    const bundle: ImportBundle = {
      ...emptyBundle(),
      withoutCallings: {
        ...emptyBundle().withoutCallings,
        listedCount: 1,
        candidates: [{ name: 'Test, Alice', category: 'adult', gender: 'F' }],
      },
      memberList: {
        ...emptyBundle().memberList,
        listedCount: 1,
        entries: [{ name: 'Test, Bob', category: 'youth', gender: 'M' }],
      },
    };

    const copied = allowListImport(bundle);
    expect(copied.withoutCallings.candidates[0]?.gender).toBe('F');
    expect(copied.memberList.entries[0]?.gender).toBe('M');

    const copiedList = allowListMemberList(bundle.memberList);
    expect(copiedList.entries[0]?.gender).toBe('M');
  });

  it('allow-list rejects a gender other than M or F', () => {
    // allowListMemberList rejects non-M/F
    const badMemberList = {
      ...emptyBundle().memberList,
      entries: [{ name: 'Bad, Gender', category: 'adult', gender: 'X' }] as unknown as readonly MemberListEntry[],
    };
    expect(() => allowListMemberList(badMemberList)).toThrow(AllowListError);
    try {
      allowListMemberList(badMemberList);
    } catch (err: unknown) {
      assert.ok(err instanceof AllowListError);
      expect(err.code).toBe('invalid_value');
      expect(err.message).toBe('allow-list gender is not M or F');
    }

    const nullGenderList = {
      ...emptyBundle().memberList,
      entries: [{ name: 'Bad, NullGender', category: 'adult', gender: null }] as unknown as readonly MemberListEntry[],
    };
    expect(() => allowListMemberList(nullGenderList)).toThrow(AllowListError);

    // allowListImport rejects non-M/F on candidate
    const badBundle: ImportBundle = {
      ...emptyBundle(),
      withoutCallings: {
        ...emptyBundle().withoutCallings,
        candidates: [{ name: 'Bad, CandGender', category: 'adult', gender: 'unknown' }] as unknown as readonly WithoutCallingsCandidate[],
      },
    };
    expect(() => allowListImport(badBundle)).toThrow(AllowListError);
    try {
      allowListImport(badBundle);
    } catch (err: unknown) {
      assert.ok(err instanceof AllowListError);
      expect(err.code).toBe('invalid_value');
      expect(err.message).toBe('allow-list gender is not M or F');
    }
  });

  it('reconcile settles gender from without-callings and unique member-list rows', () => {
    const bundle: ImportBundle = {
      organizations: {
        kind: 'organizations',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        organizations: [
          {
            name: 'Relief Society',
            groups: [
              {
                name: 'Presidency',
                positions: [
                  { title: 'President', custom: false, occupant: 'Called, Sister' },
                ],
              },
            ],
          },
        ],
      },
      withoutCallings: {
        kind: 'without-callings',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 1,
        excludedUnder11: 0,
        candidates: [{ name: 'Uncalled, Brother', category: 'adult', gender: 'M' }],
      },
      outOfUnit: {
        kind: 'out-of-unit',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        externalCallings: [],
      },
      memberList: {
        kind: 'member-list',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 2,
        excludedUnder11: 0,
        entries: [
          { name: 'Called, Sister', category: 'adult', gender: 'F' },
          { name: 'Uncalled, Brother', category: 'adult', gender: 'M' },
        ],
      },
    };

    const res = reconcile({ bundle, members: [] });
    const sister = res.decisions.find((d) => d.name === 'Called, Sister');
    assert.ok(sister);
    expect(sister.gender).toBe('F');

    const brother = res.decisions.find((d) => d.name === 'Uncalled, Brother');
    assert.ok(brother);
    expect(brother.gender).toBe('M');
  });

  it('a namesake in the member list without a without-callings row has null gender', () => {
    const bundle: ImportBundle = {
      organizations: {
        kind: 'organizations',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        organizations: [
          {
            name: 'Elders Quorum',
            groups: [
              {
                name: 'Presidency',
                positions: [
                  { title: 'President', custom: false, occupant: 'Westdale, Gus' },
                ],
              },
            ],
          },
        ],
      },
      withoutCallings: emptyBundle().withoutCallings,
      outOfUnit: emptyBundle().outOfUnit,
      memberList: {
        kind: 'member-list',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 2,
        excludedUnder11: 0,
        entries: [
          { name: 'Westdale, Gus', category: 'youth', gender: 'M' },
          { name: 'Westdale, Gus', category: 'adult', gender: 'M' },
        ],
      },
    };

    const res = reconcile({ bundle, members: [] });
    const gus = res.decisions.find((d) => d.name === 'Westdale, Gus');
    assert.ok(gus);
    expect(gus.gender).toBeNull();
  });

  it('a gender disagreement between without-callings and member-list becomes null', () => {
    const bundle: ImportBundle = {
      organizations: emptyBundle().organizations,
      withoutCallings: {
        kind: 'without-callings',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 1,
        excludedUnder11: 0,
        candidates: [{ name: 'Disputed, Sam', category: 'adult', gender: 'M' }],
      },
      outOfUnit: emptyBundle().outOfUnit,
      memberList: {
        kind: 'member-list',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 1,
        excludedUnder11: 0,
        entries: [{ name: 'Disputed, Sam', category: 'adult', gender: 'F' }],
      },
    };

    const res = reconcile({ bundle, members: [] });
    const sam = res.decisions.find((d) => d.name === 'Disputed, Sam');
    assert.ok(sam);
    expect(sam.gender).toBeNull();
  });

  it('report conflict on gender between two without-callings rows results in null gender and ambiguous', () => {
    const bundle: ImportBundle = {
      organizations: emptyBundle().organizations,
      withoutCallings: {
        kind: 'without-callings',
        unitName: 'Cedar 14th Ward',
        reportDate: '2026-10-25',
        listedCount: 2,
        excludedUnder11: 0,
        candidates: [
          { name: 'Conflict, Taylor', category: 'adult', gender: 'M' },
          { name: 'Conflict, Taylor', category: 'adult', gender: 'F' },
        ],
      },
      outOfUnit: emptyBundle().outOfUnit,
      memberList: emptyBundle().memberList,
    };

    const res = reconcile({ bundle, members: [] });
    const taylor = res.decisions.find((d) => d.name === 'Conflict, Taylor');
    assert.ok(taylor);
    expect(taylor.kind).toBe('ambiguous');
    if (taylor.kind === 'ambiguous') {
      expect(taylor.reason).toBe('report_conflict');
    }
    expect(taylor.gender).toBeNull();
  });
});
