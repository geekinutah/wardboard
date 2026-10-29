import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalName,
  extractPdf,
  importReports,
  reconcile,
  ReconcileError,
  reportFingerprint,
  type ImportBundle,
  type OrganizationsReport,
  type OutOfUnitSection,
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
};

interface BundleOptions {
  readonly occupants?: readonly (string | null)[];
  readonly candidates?: readonly { readonly name: string; readonly category: 'adult' | 'youth' }[];
  readonly externalCallings?: readonly {
    readonly section: OutOfUnitSection;
    readonly name: string;
    readonly calling: string;
    readonly servingUnit: string | null;
  }[];
  readonly organizationsUnitName?: string;
  readonly withoutCallingsUnitName?: string;
  readonly outOfUnitUnitName?: string;
  readonly organizationsDate?: string;
  readonly withoutCallingsDate?: string;
  readonly outOfUnitDate?: string;
  readonly positionTitle?: string;
}

function bundle(options: BundleOptions = {}): ImportBundle {
  const occupants = options.occupants ?? [];
  const candidates = options.candidates ?? [];
  const externalCallings = options.externalCallings ?? [];
  const title = options.positionTitle ?? 'Bishop';
  return {
    organizations: {
      kind: 'organizations',
      unitName: options.organizationsUnitName ?? UNIT,
      reportDate: options.organizationsDate ?? DATE,
      organizations:
        occupants.length === 0
          ? []
          : [
              {
                name: 'Bishopric',
                groups: [
                  {
                    name: 'Bishopric',
                    positions: occupants.map((occupant) => ({
                      title,
                      custom: false,
                      occupant,
                    })),
                  },
                ],
              },
            ],
    },
    withoutCallings: {
      kind: 'without-callings',
      unitName: options.withoutCallingsUnitName ?? UNIT,
      reportDate: options.withoutCallingsDate ?? DATE,
      listedCount: candidates.length,
      excludedUnder11: 0,
      candidates: candidates.map((candidate) => ({ ...candidate })),
    },
    outOfUnit: {
      kind: 'out-of-unit',
      unitName: options.outOfUnitUnitName ?? UNIT,
      reportDate: options.outOfUnitDate ?? DATE,
      externalCallings: externalCallings.map((calling) => ({ ...calling })),
    },
  };
}

function personKeys(imported: ImportBundle): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    const key = canonicalName(name);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    keys.push(key);
  };
  for (const organization of imported.organizations.organizations) {
    for (const group of organization.groups) {
      for (const position of group.positions) {
        if (position.occupant !== null) {
          add(position.occupant);
        }
      }
    }
  }
  for (const candidate of imported.withoutCallings.candidates) {
    add(candidate.name);
  }
  for (const calling of imported.outOfUnit.externalCallings) {
    add(calling.name);
  }
  return keys;
}

function spyConsole(): { readonly calls: () => number; readonly restore: () => void } {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((method) => vi.spyOn(console, method));
  return {
    calls: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}

function thrownReconcileError(run: () => void): ReconcileError {
  try {
    run();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(ReconcileError);
    if (err instanceof ReconcileError) {
      return err;
    }
  }
  throw new Error('expected ReconcileError');
}

describe('T-057 identity reconciliation', () => {
  it('canonicalName folds case, marks, space, and comma spacing', () => {
    expect(canonicalName('Stanley, Zed')).toBe('stanley, zed');
    expect(canonicalName('Stanley,  Zed')).toBe('stanley, zed');
    expect(canonicalName('Áda Fictional')).toBe('ada fictional');
    expect(canonicalName('Zed Stanley')).toBe('zed stanley');
    expect(canonicalName('Stanley, Zed')).not.toBe(canonicalName('Zed Stanley'));
  });

  it('exact unique name matches and reuses the member id', () => {
    const result = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [
        { id: 'other', name: 'Quinn, Una' },
        { id: 'member-zed', name: 'STANLEY, ZED' },
      ],
    });
    expect(result.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'matched',
        memberId: 'member-zed',
      },
    ]);
    expect(result.absent).toStrictEqual([{ memberId: 'other', name: 'Quinn, Una' }]);
    expect(result.duplicates).toStrictEqual([]);
    expect(result.inconsistentReports).toBe(false);
  });

  it('namesakes are not merged', () => {
    const result = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [
        { id: 'm2', name: 'Stanley, Zed' },
        { id: 'm1', name: 'STANLEY, ZED' },
      ],
    });
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toStrictEqual({
      name: 'Stanley, Zed',
      key: 'stanley, zed',
      category: null,
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'namesake',
      candidates: [
        { memberId: 'm2', name: 'Stanley, Zed' },
        { memberId: 'm1', name: 'STANLEY, ZED' },
      ],
    });
    expect(result.absent).toStrictEqual([]);
  });

  it('a resemblance stays beside namesakes', () => {
    const result = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [
        { id: 'rev', name: 'Zed Stanley' },
        { id: 'm2', name: 'Stanley, Zed' },
        { id: 'm1', name: 'STANLEY, ZED' },
      ],
    });
    expect(result.decisions[0]).toMatchObject({
      kind: 'ambiguous',
      reason: 'namesake',
      candidates: [
        { memberId: 'm2', name: 'Stanley, Zed' },
        { memberId: 'm1', name: 'STANLEY, ZED' },
        { memberId: 'rev', name: 'Zed Stanley' },
      ],
    });
    expect(result.absent).toStrictEqual([]);
  });

  it('a reversed name resembles and is not matched', () => {
    const reversed = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [{ id: 'rev', name: 'Zed Stanley' }],
    });
    expect(reversed.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'ambiguous',
        reason: 'resembles',
        candidates: [{ memberId: 'rev', name: 'Zed Stanley' }],
      },
    ]);
    expect(reversed.absent).toStrictEqual([]);

    const separateKeys = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed', 'Zed Stanley'] }),
      members: [{ id: 'comma', name: 'Stanley, Zed' }],
    });
    expect(separateKeys.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'matched',
        memberId: 'comma',
      },
      {
        name: 'Zed Stanley',
        key: 'zed stanley',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'new',
      },
    ]);
    expect(separateKeys.absent).toStrictEqual([]);
  });

  it('a unique exact match with a resemblance is not automatic', () => {
    const result = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [
        { id: 'paul', name: 'Stanley, Zed Paul' },
        { id: 'exact', name: 'Stanley, Zed' },
      ],
    });
    expect(result.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'ambiguous',
        reason: 'resembles',
        candidates: [
          { memberId: 'exact', name: 'Stanley, Zed' },
          { memberId: 'paul', name: 'Stanley, Zed Paul' },
        ],
      },
    ]);
    expect(result.absent).toStrictEqual([]);
  });

  it('a different given name is new', () => {
    const zoe = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [{ id: 'zoe', name: 'Stanley, Zoe' }],
    });
    expect(zoe.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'new',
      },
    ]);
    expect(zoe.absent).toStrictEqual([{ memberId: 'zoe', name: 'Stanley, Zoe' }]);

    const anna = reconcile({
      bundle: bundle({ occupants: ['Smith, Ann'] }),
      members: [{ id: 'anna', name: 'Smith, Anna' }],
    });
    expect(anna.decisions[0]).toMatchObject({ kind: 'new', key: 'smith, ann' });
    expect(anna.absent).toStrictEqual([{ memberId: 'anna', name: 'Smith, Anna' }]);

    const ann = reconcile({
      bundle: bundle({ occupants: ['Smith, Anna'] }),
      members: [{ id: 'ann', name: 'Smith, Ann' }],
    });
    expect(ann.decisions[0]).toMatchObject({ kind: 'new', key: 'smith, anna' });
    expect(ann.absent).toStrictEqual([{ memberId: 'ann', name: 'Smith, Ann' }]);
  });

  it('a shared given token resembles', () => {
    const longer = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed'] }),
      members: [{ id: 'paul', name: 'Stanley, Zed Paul' }],
    });
    expect(longer.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'ambiguous',
        reason: 'resembles',
        candidates: [{ memberId: 'paul', name: 'Stanley, Zed Paul' }],
      },
    ]);
    expect(longer.absent).toStrictEqual([]);

    const shared = reconcile({
      bundle: bundle({ occupants: ['Stanley, Zed', 'Stanley, Zoe'] }),
      members: [{ id: 'both', name: 'Stanley, Zed Zoe' }],
    });
    expect(shared.decisions.map((decision) => decision.name)).toStrictEqual(['Stanley, Zed', 'Stanley, Zoe']);
    expect(shared.decisions[0]).toMatchObject({
      kind: 'ambiguous',
      reason: 'resembles',
      candidates: [{ memberId: 'both', name: 'Stanley, Zed Zoe' }],
    });
    expect(shared.decisions[1]).toMatchObject({
      kind: 'ambiguous',
      reason: 'resembles',
      candidates: [{ memberId: 'both', name: 'Stanley, Zed Zoe' }],
    });
    expect(shared.absent).toStrictEqual([]);
  });

  it('a calling and a without-callings row conflict', () => {
    const conflict = reconcile({
      bundle: bundle({
        occupants: ['Stanley, Zed'],
        candidates: [{ name: 'STANLEY, ZED', category: 'youth' }],
      }),
      members: [
        { id: 'exact', name: 'Stanley, Zed' },
        { id: 'keep', name: 'Quinn, Una' },
        { id: 'rev', name: 'Zed Stanley' },
        { id: 'also', name: 'Birch, Ada' },
      ],
    });
    expect(conflict.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations', 'without-callings'],
        externalCallings: [],
        kind: 'ambiguous',
        reason: 'report_conflict',
        candidates: [],
      },
    ]);
    expect(conflict.absent).toStrictEqual([
      { memberId: 'keep', name: 'Quinn, Una' },
      { memberId: 'also', name: 'Birch, Ada' },
    ]);

    const splitCategory = reconcile({
      bundle: bundle({
        candidates: [
          { name: 'Ada Fictional', category: 'adult' },
          { name: 'Ada Fictional', category: 'youth' },
        ],
      }),
      members: [{ id: 'ada', name: 'Ada Fictional' }],
    });
    expect(splitCategory.decisions).toStrictEqual([
      {
        name: 'Ada Fictional',
        key: 'ada fictional',
        category: null,
        sources: ['without-callings'],
        externalCallings: [],
        kind: 'ambiguous',
        reason: 'report_conflict',
        candidates: [],
      },
    ]);
    expect(splitCategory.absent).toStrictEqual([]);

    const youth = reconcile({
      bundle: bundle({
        candidates: [
          { name: 'Kelley, Kaia', category: 'youth' },
          { name: 'Kelley, Kaia', category: 'youth' },
        ],
      }),
      members: [{ id: 'k', name: 'Kelley, Kaia' }],
    });
    expect(youth.decisions).toStrictEqual([
      {
        name: 'Kelley, Kaia',
        key: 'kelley, kaia',
        category: 'youth',
        sources: ['without-callings'],
        externalCallings: [],
        kind: 'matched',
        memberId: 'k',
      },
    ]);

    const outsideAndCandidate = reconcile({
      bundle: bundle({
        candidates: [{ name: 'Melford, Leo', category: 'adult' }],
        externalCallings: [
          { section: 'stake', name: 'Melford, Leo', calling: 'Stake Clerk', servingUnit: null },
        ],
      }),
      members: [],
    });
    expect(outsideAndCandidate.decisions).toStrictEqual([
      {
        name: 'Melford, Leo',
        key: 'melford, leo',
        category: 'adult',
        sources: ['without-callings', 'out-of-unit'],
        externalCallings: [{ section: 'stake', calling: 'Stake Clerk', servingUnit: null }],
        kind: 'new',
      },
    ]);
  });

  it('external callings stay on one person', () => {
    const result = reconcile({
      bundle: bundle({
        occupants: ['Melford, Leo'],
        externalCallings: [
          {
            section: 'stake',
            name: 'Melford, Leo',
            calling: 'Stake Sports Specialist',
            servingUnit: null,
          },
          {
            section: 'serving-outside-unit',
            name: 'Melford,  Leo',
            calling: 'Ordinance Worker',
            servingUnit: 'Cedar Peak Utah Temple',
          },
        ],
      }),
      members: [],
    });
    expect(result.decisions).toStrictEqual([
      {
        name: 'Melford, Leo',
        key: 'melford, leo',
        category: null,
        sources: ['organizations', 'out-of-unit'],
        externalCallings: [
          { section: 'stake', calling: 'Stake Sports Specialist', servingUnit: null },
          {
            section: 'serving-outside-unit',
            calling: 'Ordinance Worker',
            servingUnit: 'Cedar Peak Utah Temple',
          },
        ],
        kind: 'new',
      },
    ]);
  });

  it('vacancies and empty imports create no people', () => {
    const members = [
      { id: 'b', name: 'Birch, Ada' },
      { id: 'a', name: 'Ash, Bo' },
    ];
    const absent = [
      { memberId: 'b', name: 'Birch, Ada' },
      { memberId: 'a', name: 'Ash, Bo' },
    ];
    const vacant = reconcile({ bundle: bundle({ occupants: [null] }), members });
    expect(vacant.decisions).toStrictEqual([]);
    expect(vacant.absent).toStrictEqual(absent);

    const empty = reconcile({ bundle: bundle({}), members });
    expect(empty.decisions).toStrictEqual([]);
    expect(empty.absent).toStrictEqual(absent);

    const mixed = reconcile({
      bundle: bundle({ occupants: [null, 'Stanley, Zed'] }),
      members: [],
    });
    expect(mixed.decisions.map((decision) => decision.name)).toStrictEqual(['Stanley, Zed']);
  });

  it('duplicate fingerprints are flagged and people remain', () => {
    const imported = bundle({ occupants: ['Stanley, Zed'] });
    const retitled = bundle({ occupants: ['Stanley, Zed'], positionTitle: 'Clerk' });
    const organizationsFingerprint = reportFingerprint(imported.organizations);
    const retitledFingerprint = reportFingerprint(retitled.organizations);
    expect(organizationsFingerprint).toBe(
      createHash('sha256').update(JSON.stringify(imported.organizations)).digest('hex'),
    );
    expect(organizationsFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(retitledFingerprint).not.toBe(organizationsFingerprint);

    const reordered: OrganizationsReport = {
      reportDate: imported.organizations.reportDate,
      organizations: imported.organizations.organizations,
      unitName: imported.organizations.unitName,
      kind: imported.organizations.kind,
    };
    expect(reportFingerprint(reordered)).not.toBe(organizationsFingerprint);

    const duplicated = reconcile({
      bundle: imported,
      members: [],
      previousFingerprints: {
        'out-of-unit': reportFingerprint(imported.outOfUnit),
        organizations: organizationsFingerprint,
        'without-callings': reportFingerprint(imported.withoutCallings),
      },
    });
    expect(duplicated.duplicates).toStrictEqual(['organizations', 'without-callings', 'out-of-unit']);
    expect(duplicated.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'new',
      },
    ]);

    const differentTitle = reconcile({
      bundle: imported,
      members: [],
      previousFingerprints: { organizations: retitledFingerprint },
    });
    expect(differentTitle.duplicates).toStrictEqual([]);
    expect(differentTitle.decisions[0]).toMatchObject({ name: 'Stanley, Zed', kind: 'new' });

    const missingPrevious = reconcile({ bundle: imported, members: [] });
    expect(missingPrevious.duplicates).toStrictEqual([]);
  });

  it('disagreeing headers are flagged', () => {
    const dated = reconcile({
      bundle: bundle({
        occupants: ['Stanley, Zed'],
        withoutCallingsDate: '2026-10-26',
      }),
      members: [],
    });
    expect(dated.inconsistentReports).toBe(true);
    expect(dated.decisions).toStrictEqual([
      {
        name: 'Stanley, Zed',
        key: 'stanley, zed',
        category: null,
        sources: ['organizations'],
        externalCallings: [],
        kind: 'new',
      },
    ]);

    const spacedDate = reconcile({
      bundle: bundle({ organizationsDate: '2026-10-25 ' }),
      members: [],
    });
    expect(spacedDate.inconsistentReports).toBe(true);
    expect(spacedDate.decisions).toStrictEqual([]);

    const otherUnit = reconcile({
      bundle: bundle({ withoutCallingsUnitName: 'Cedar 15th Ward' }),
      members: [],
    });
    expect(otherUnit.inconsistentReports).toBe(true);

    const foldedUnit = reconcile({
      bundle: bundle({
        organizationsUnitName: 'Cedar 14th Ward',
        withoutCallingsUnitName: 'cedar  14th ward',
        outOfUnitUnitName: 'Cedar 14th Ward',
      }),
      members: [],
    });
    expect(foldedUnit.inconsistentReports).toBe(false);

    const emptyUnits = reconcile({
      bundle: bundle({
        organizationsUnitName: '   ',
        withoutCallingsUnitName: '',
        outOfUnitUnitName: '',
      }),
      members: [{ id: 'm', name: 'Quinn, Una' }],
    });
    expect(emptyUnits.inconsistentReports).toBe(false);
    expect(emptyUnits.decisions).toStrictEqual([]);
    expect(emptyUnits.absent).toStrictEqual([{ memberId: 'm', name: 'Quinn, Una' }]);
  });

  it('an empty name throws without logging', () => {
    const logs: string[] = [];
    const consoleSpy = spyConsole();
    const log = (line: string): void => {
      logs.push(line);
    };
    try {
      const occupantError = thrownReconcileError(() => {
        reconcile({ bundle: bundle({ occupants: ['   '] }), members: [], log });
      });
      expect(occupantError.code).toBe('invalid_name');
      expect(occupantError.message).toBe('reconcile name is empty');
      expect(occupantError.name).toBe('ReconcileError');

      const memberError = thrownReconcileError(() => {
        reconcile({
          bundle: bundle({ occupants: ['Stanley, Zed'] }),
          members: [{ id: 'blank', name: ' ' }],
          log,
        });
      });
      expect(memberError.code).toBe('invalid_name');
      expect(memberError.message).toBe('reconcile name is empty');
      expect(memberError.name).toBe('ReconcileError');

      const candidateError = thrownReconcileError(() => {
        reconcile({
          bundle: bundle({ candidates: [{ name: '\t', category: 'adult' }] }),
          members: [],
          log,
        });
      });
      expect(candidateError.message).toBe('reconcile name is empty');

      const externalError = thrownReconcileError(() => {
        reconcile({
          bundle: bundle({
            externalCallings: [{ section: 'stake', name: '', calling: 'Stake Clerk', servingUnit: null }],
          }),
          members: [],
          log,
        });
      });
      expect(externalError.message).toBe('reconcile name is empty');
      expect(logs).toStrictEqual([]);
      expect(consoleSpy.calls()).toBe(0);
    } finally {
      consoleSpy.restore();
    }
  });

  it('the log is counts only', () => {
    const imported = bundle({
      occupants: ['Stanley, Zed', 'Ada Fictional'],
      candidates: [{ name: 'Niles, Owen', category: 'adult' }],
    });
    const logs: string[] = [];
    const consoleSpy = spyConsole();
    try {
      const result = reconcile({
        bundle: imported,
        members: [
          { id: 'm-zed', name: 'Stanley, Zed' },
          { id: 'm-owen', name: 'Owen Niles' },
          { id: 'm-una', name: 'Quinn, Una' },
        ],
        previousFingerprints: { organizations: reportFingerprint(imported.organizations) },
        log: (line) => {
          logs.push(line);
        },
      });
      const matched = result.decisions.filter((decision) => decision.kind === 'matched').length;
      const created = result.decisions.filter((decision) => decision.kind === 'new').length;
      const ambiguous = result.decisions.filter((decision) => decision.kind === 'ambiguous').length;
      expect(logs).toStrictEqual([
        `reconcile matched=${String(matched)} new=${String(created)} ambiguous=${String(ambiguous)} absent=${String(result.absent.length)} duplicates=${String(result.duplicates.length)}`,
      ]);
      expect(logs).toStrictEqual(['reconcile matched=1 new=1 ambiguous=1 absent=1 duplicates=1']);
      const line = logs[0] ?? '';
      expect(line.includes('Stanley')).toBe(false);
      expect(line.includes('Zed')).toBe(false);
      expect(consoleSpy.calls()).toBe(0);
    } finally {
      consoleSpy.restore();
    }
  });

  it('fixture reconciliation is deterministic and leaks no phone', () => {
    const consoleSpy = spyConsole();
    const logs: string[] = [];
    try {
      const firstBundle = importReports(fixtureDocs);
      const secondBundle = importReports(fixtureDocs);
      const first = reconcile({
        bundle: firstBundle,
        members: [],
        log: (line) => {
          logs.push(line);
        },
      });
      const second = reconcile({
        bundle: secondBundle,
        members: [],
        log: (line) => {
          logs.push(line);
        },
      });
      expect(first).toStrictEqual(second);
      expect(first.decisions.map((decision) => decision.key)).toStrictEqual(personKeys(firstBundle));
      const stanley = first.decisions.find((decision) => decision.name === 'Stanley, Zed');
      expect(stanley).toMatchObject({ kind: 'new', key: 'stanley, zed' });
      expect(first.decisions.filter((decision) => decision.name === 'Stanley, Zed')).toHaveLength(1);
      expect(first.decisions.some((decision) => decision.key === 'stanley, piper')).toBe(true);
      expect(first.decisions.some((decision) => decision.key === 'stanley, glen')).toBe(true);
      expect(first.decisions.some((decision) => decision.name === 'Calling Vacant')).toBe(false);
      const gus = first.decisions.find((decision) => decision.key === 'westdale, gus');
      expect(gus).toMatchObject({
        kind: 'ambiguous',
        reason: 'report_conflict',
        category: null,
        candidates: [],
      });
      const keys = new Set(first.decisions.map((decision) => decision.key));
      expect(keys.has('wrenford, boyd')).toBe(true);
      expect(keys.has('wrenford, isaac boyd')).toBe(true);
      expect(JSON.stringify(first).includes('555-0100')).toBe(false);
      expect(logs.join('\n').includes('555-0100')).toBe(false);
      expect(logs.every((line) => /^reconcile matched=\d+ new=\d+ ambiguous=\d+ absent=\d+ duplicates=\d+$/.test(line))).toBe(
        true,
      );
      expect(consoleSpy.calls()).toBe(0);
      const decisionNames = new Set(first.decisions.map((decision: PersonDecision) => decision.name));
      expect(decisionNames.has('Calling Vacant')).toBe(false);
    } finally {
      consoleSpy.restore();
    }
  });
});
