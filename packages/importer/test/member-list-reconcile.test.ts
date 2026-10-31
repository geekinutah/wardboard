import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AllowListError,
  allowListImport,
  canonicalName,
  extractPdf,
  importReports,
  MemberListReportError,
  parseMemberList,
  reconcile,
  type ImportBundle,
  type MemberGender,
  type MemberListEntry,
  type PdfDocument,
  type PersonDecision,
} from '../src/index.ts';

const UNIT = 'Cedar 14th Ward';
const DATE = '2026-10-25';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

const fixtureDocs = {
  organizations: extractPdf(loadFixture('organizations-and-callings.pdf')),
  withoutCallings: extractPdf(loadFixture('members-without-callings.pdf')),
  outOfUnit: extractPdf(loadFixture('out-of-unit-callings.pdf')),
  memberList: extractPdf(loadFixture('member-list.pdf')),
};

interface Options {
  readonly occupants?: readonly string[];
  readonly candidates?: readonly { readonly name: string; readonly category: 'adult' | 'youth'; readonly gender?: MemberGender }[];
  readonly entries?: readonly MemberListEntry[];
  readonly memberListUnitName?: string;
  readonly memberListDate?: string | null;
  readonly excludedUnder11?: number;
}

function bundle(options: Options = {}): ImportBundle {
  const occupants = options.occupants ?? [];
  const candidates = options.candidates ?? [];
  const entries = options.entries ?? [];
  const excluded = options.excludedUnder11 ?? 0;
  return {
    organizations: {
      kind: 'organizations',
      unitName: UNIT,
      reportDate: DATE,
      organizations: [
        {
          name: 'Elders Quorum',
          groups: [
            {
              name: 'Elders Quorum Presidency',
              positions: occupants.map((occupant) => ({ title: 'Teacher', custom: false, occupant })),
            },
          ],
        },
      ],
    },
    withoutCallings: {
      kind: 'without-callings',
      unitName: UNIT,
      reportDate: DATE,
      listedCount: candidates.length,
      excludedUnder11: 0,
      candidates: candidates.map((candidate) => ({ gender: 'F' as const, ...candidate })),
    },
    outOfUnit: { kind: 'out-of-unit', unitName: UNIT, reportDate: DATE, externalCallings: [] },
    memberList: {
      kind: 'member-list',
      unitName: options.memberListUnitName ?? UNIT,
      reportDate: options.memberListDate === undefined ? DATE : options.memberListDate,
      listedCount: entries.length + excluded,
      excludedUnder11: excluded,
      entries: entries.map((entry) => ({ ...entry })),
    },
  };
}

function decisionFor(decisions: readonly PersonDecision[], name: string): PersonDecision {
  const found = decisions.find((decision) => decision.key === canonicalName(name));
  if (found === undefined) throw new Error(`no decision for ${name}`);
  return found;
}

/** Reads printed name and age from the Member List rows by header x-positions. Independent of parseMemberList. */
function memberListRows(doc: PdfDocument): { name: string; age: number }[] {
  const headings = ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number', 'Email'];
  const rows: { name: string; age: number }[] = [];
  for (const page of doc.pages) {
    const header = page.rows.find((row) => headings.every((heading, index) => row.items[index]?.text === heading));
    if (header === undefined) throw new Error('missing header');
    const genderX = header.items[1]?.x ?? 0;
    const ageX = header.items[2]?.x ?? 0;
    const birthX = header.items[3]?.x ?? 0;
    for (const row of page.rows) {
      if (row.y <= header.y) continue;
      const text = row.items.map((item) => item.text).join(' ');
      if (text.includes('For Church Use Only') || text.startsWith('Count:')) continue;
      const name = row.items.filter((item) => item.x < genderX - 1).map((item) => item.text).join(' ');
      const age = row.items.filter((item) => item.x >= ageX - 1 && item.x < birthX - 1).map((item) => item.text).join('');
      rows.push({ name, age: Number(age) });
    }
  }
  return rows;
}

describe('member list in reconcile', () => {
  it('the member list fills unknown categories', () => {
    const result = reconcile({
      bundle: bundle({
        occupants: ['Ashdown, Noor', 'Brightwater, Elm', 'Zoë Calder'],
        entries: [
          { name: 'Ashdown, Noor', category: 'adult', gender: 'F' },
          { name: 'Brightwater, Elm', category: 'youth', gender: 'M' },
          { name: 'Zoe Calder', category: 'youth', gender: 'F' },
        ],
      }),
      members: [{ id: 'm-1', name: 'Brightwater, Elm' }],
    });

    const noor = decisionFor(result.decisions, 'Ashdown, Noor');
    expect(noor.kind).toBe('new');
    expect(noor.category).toBe('adult');
    const elm = decisionFor(result.decisions, 'Brightwater, Elm');
    expect(elm.kind).toBe('matched');
    expect(elm.category).toBe('youth');
    // The canonical name is the match key, so accents and case don't matter.
    expect(decisionFor(result.decisions, 'Zoë Calder').category).toBe('youth');
  });

  it('a name listed twice in the member list stays unknown', () => {
    const result = reconcile({
      bundle: bundle({
        occupants: ['Westbrook, Gil', 'Ashdown, Noor'],
        candidates: [{ name: 'Fennick, Rue', category: 'adult' }],
        entries: [
          { name: 'Westbrook, Gil', category: 'adult', gender: 'M' },
          { name: 'Westbrook, Gil', category: 'adult', gender: 'M' },
          { name: 'Ashdown, Noor', category: 'youth', gender: 'F' },
          { name: 'Fennick, Rue', category: 'adult', gender: 'F' },
          { name: 'Fennick, Rue', category: 'youth', gender: 'F' },
        ],
      }),
      members: [],
    });

    // Two people print as the same name, even with the same category: never guess between them.
    expect(decisionFor(result.decisions, 'Westbrook, Gil').category).toBeNull();
    expect(decisionFor(result.decisions, 'Ashdown, Noor').category).toBe('youth');
    // A Members without Callings age is kept when the Member List can't settle the name.
    expect(decisionFor(result.decisions, 'Fennick, Rue').category).toBe('adult');
  });

  it('a child in the member list gives no category', () => {
    const memberList = parseMemberList(fixtureDocs.memberList);
    const child = memberListRows(fixtureDocs.memberList).find((row) => row.age < 11);
    if (child === undefined) throw new Error('the fixture has no child row');
    expect(memberList.excludedUnder11).toBeGreaterThan(0);

    const synthetic = bundle({ occupants: [child.name] });
    const result = reconcile({ bundle: { ...synthetic, memberList }, members: [] });

    const decision = decisionFor(result.decisions, child.name);
    expect(decision.category).toBeNull();
    expect(decision.kind).toBe('new');
  });

  it('the member list never overrides or adds people', () => {
    const members = [
      { id: 'm-1', name: 'Ashdown, Noor' },
      { id: 'm-2', name: 'Calder, Ivy Rose' },
      { id: 'm-3', name: 'Calder, Ivy' },
      { id: 'm-4', name: 'Dunmore, Pell' },
    ];
    const reports = {
      occupants: ['Ashdown, Noor', 'Calder, Ivy', 'Brightwater, Elm'],
      candidates: [{ name: 'Fennick, Rue', category: 'youth' as const }],
    };
    const without = reconcile({ bundle: bundle(reports), members });
    const withList = reconcile({
      bundle: bundle({
        ...reports,
        entries: [
          { name: 'Ashdown, Noor', category: 'adult', gender: 'F' },
          { name: 'Calder, Ivy', category: 'adult', gender: 'F' },
          { name: 'Brightwater, Elm', category: 'adult', gender: 'M' },
          { name: 'Fennick, Rue', category: 'youth', gender: 'F' },
          { name: 'Dunmore, Pell', category: 'adult', gender: 'M' },
          { name: 'Eastly, Wren', category: 'youth', gender: 'F' },
        ],
      }),
      members,
    });

    const shape = (decisions: readonly PersonDecision[]): unknown[] =>
      decisions.map((decision) => ({ ...decision, category: 'ignored', gender: 'ignored' }));
    expect(shape(withList.decisions)).toEqual(shape(without.decisions));
    expect(withList.decisions.map((decision) => decision.key)).toEqual([
      'ashdown, noor',
      'calder, ivy',
      'brightwater, elm',
      'fennick, rue',
    ]);
    expect(withList.absent).toEqual(without.absent);
    expect(withList.absent).toEqual([{ memberId: 'm-4', name: 'Dunmore, Pell' }]);
    expect(withList.inconsistentReports).toBe(false);
    expect(decisionFor(withList.decisions, 'Calder, Ivy').kind).toBe('ambiguous');
  });

  it('a disagreement asks instead of choosing', () => {
    const result = reconcile({
      bundle: bundle({
        candidates: [
          { name: 'Fennick, Rue', category: 'youth' },
          { name: 'Garrow, Lark', category: 'youth' },
        ],
        entries: [
          { name: 'Fennick, Rue', category: 'adult', gender: 'F' },
          { name: 'Garrow, Lark', category: 'youth', gender: 'F' },
        ],
      }),
      members: [],
    });

    expect(decisionFor(result.decisions, 'Fennick, Rue').category).toBeNull();
    expect(decisionFor(result.decisions, 'Garrow, Lark').category).toBe('youth');
  });

  it('a member list for another unit is inconsistent', () => {
    const other = reconcile({ bundle: bundle({ memberListUnitName: 'Cedar 15th Ward' }), members: [] });
    expect(other.inconsistentReports).toBe(true);

    const sameUnit = reconcile({ bundle: bundle({ memberListUnitName: 'CEDAR 14TH WARD' }), members: [] });
    expect(sameUnit.inconsistentReports).toBe(false);
  });

  it('the member list date does not make reports inconsistent', () => {
    expect(reconcile({ bundle: bundle({ memberListDate: null }), members: [] }).inconsistentReports).toBe(false);
    expect(reconcile({ bundle: bundle({ memberListDate: '2026-10-29' }), members: [] }).inconsistentReports).toBe(false);
  });

  it('the fixture member list settles everyone but the namesakes', () => {
    const imported = importReports(fixtureDocs);
    const withList = reconcile({ bundle: imported, members: [] });
    const unknown = withList.decisions.filter((decision) => decision.category === null).map((decision) => decision.name);
    expect(unknown).toEqual(['Westdale, Gus', 'Fairwell, Sage Casey Kendall Reagan']);

    const withoutList = reconcile({
      bundle: { ...imported, memberList: { ...imported.memberList, entries: [] } },
      members: [],
    });
    expect(withoutList.decisions.filter((decision) => decision.category === null)).toHaveLength(146);
    expect(withList.decisions.map((decision) => decision.kind)).toEqual(
      withoutList.decisions.map((decision) => decision.kind),
    );
  });
});

describe('member list in importReports', () => {
  it('importReports parses and allow-lists the member list', () => {
    const logs: string[] = [];
    const imported = importReports(fixtureDocs, (line) => {
      logs.push(line);
    });

    expect(imported.memberList.kind).toBe('member-list');
    expect(imported.memberList.unitName).toBe(UNIT);
    expect(imported.memberList.listedCount).toBe(293);
    expect(imported.memberList.excludedUnder11).toBe(33);
    expect(imported.memberList.entries).toHaveLength(260);
    for (const entry of imported.memberList.entries) {
      expect(Object.keys(entry).sort()).toEqual(['category', 'gender', 'name']);
    }
    // No new log line, and the existing line names no person.
    expect(logs).toEqual(['allow-list organizations=244 candidates=112 external=37']);
  });

  it('a member list that fails to parse rejects the import', () => {
    const logs: string[] = [];
    expect(() =>
      importReports({ ...fixtureDocs, memberList: fixtureDocs.withoutCallings }, (line) => {
        logs.push(line);
      }),
    ).toThrow(MemberListReportError);
    expect(logs).toEqual([]);
  });

  it('allowListImport refuses a member list of the wrong kind', () => {
    const imported = importReports(fixtureDocs);
    const wrong = { ...imported, memberList: { ...imported.memberList, kind: 'without-callings' } };
    expect(() => allowListImport(wrong as unknown as Parameters<typeof allowListImport>[0])).toThrow(AllowListError);
  });

  it('allowListImport keeps only name, category and gender from member list entries', () => {
    const imported = importReports(fixtureDocs);
    const planted = {
      ...imported,
      memberList: {
        ...imported.memberList,
        gender: 'CANARY-GENDER',
        entries: [{ name: 'Ashdown, Noor', category: 'adult', gender: 'F' as const, phone: 'CANARY-PHONE-555-0199' }],
      },
    };
    const copied = allowListImport(planted as unknown as Parameters<typeof allowListImport>[0]);
    expect(copied.memberList.entries).toEqual([{ name: 'Ashdown, Noor', category: 'adult', gender: 'F' }]);
    expect(JSON.stringify(copied).includes('CANARY')).toBe(false);
  });
});
