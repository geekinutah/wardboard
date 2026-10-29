import { describe, expect, it } from 'vitest';
import {
  planImportReview,
  resolutionsFor,
  type ImportPreview,
  type PersonDecision,
} from './plan.ts';

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    decisions: overrides.decisions ?? [],
    absent: overrides.absent ?? [],
    duplicates: overrides.duplicates ?? [],
    inconsistentReports: overrides.inconsistentReports ?? false,
    returning: overrides.returning ?? [],
    needsCategory: overrides.needsCategory ?? [],
    unfamiliar: overrides.unfamiliar ?? [],
    keptPositions: overrides.keptPositions ?? 0,
    matchedPositions: overrides.matchedPositions ?? 0,
  };
}

function namesake(): PersonDecision {
  return {
    name: 'Lark, June',
    key: 'lark, june',
    category: null,
    sources: ['organizations'],
    externalCallings: [],
    kind: 'ambiguous',
    reason: 'namesake',
    candidates: [
      { memberId: 'm-june', name: 'June Lark' },
      { memberId: 'm-junel', name: 'June L. Lark' },
    ],
  };
}

describe('planImportReview', () => {
  it('stats come from the preview counts', () => {
    const sample = preview({
      decisions: [
        {
          name: 'Alder, Ada',
          key: 'alder, ada',
          category: 'adult',
          sources: ['organizations'],
          externalCallings: [
            { section: 'stake', calling: 'Clerk', servingUnit: null },
            { section: 'stake', calling: 'Auditor', servingUnit: 'North' },
          ],
          kind: 'matched',
          memberId: 'm-ada',
        },
        {
          name: 'Beck, Ben',
          key: 'beck, ben',
          category: 'youth',
          sources: ['out-of-unit'],
          externalCallings: [{ section: 'serving-outside-unit', calling: 'Missionary', servingUnit: 'East' }],
          kind: 'new',
        },
      ],
      absent: [
        { memberId: 'm-1', name: 'One' },
        { memberId: 'm-2', name: 'Two' },
        { memberId: 'm-3', name: 'Three' },
        { memberId: 'm-4', name: 'Four' },
        { memberId: 'm-5', name: 'Five' },
      ],
      keptPositions: 7,
      matchedPositions: 11,
      unfamiliar: [
        { organization: 'Elders', group: 'Other', title: 'Custom', vacant: true },
        { organization: 'Relief Society', group: 'Other', title: 'Another', vacant: false },
      ],
    });
    const before = JSON.parse(JSON.stringify(sample)) as ImportPreview;

    const review = planImportReview(sample);

    expect(sample).toEqual(before);
    expect(review.stats).toEqual([
      { label: 'People', value: 2 },
      { label: 'Matched positions', value: 11 },
      { label: 'Kept positions', value: 7 },
      { label: 'Outside-ward callings', value: 3 },
      { label: 'Unfamiliar callings', value: 2 },
    ]);
    expect(review.stats.map((stat) => stat.value)).not.toEqual([312, 248, 95, 37, 4]);
    expect(review.sources).toEqual([
      { name: 'Callings by Organization', detail: 'Included in this preview', status: 'Validated' },
      { name: 'Members without Callings', detail: 'Included in this preview', status: 'Validated' },
      { name: 'Out-of-Unit Callings', detail: 'Included in this preview', status: 'Validated' },
      {
        name: 'Directory photos',
        detail: 'Optional · upload in the app or collect later',
        status: 'Not collected yet',
      },
    ]);
    expect(review.blocked).toBeNull();
    expect(review.rows).toEqual([]);
  });

  it('a namesake stays unresolved until a candidate or a new category is chosen', () => {
    const sample = preview({
      decisions: [namesake()],
      needsCategory: ['lark, june'],
    });

    expect(planImportReview(sample).rows).toEqual([
      {
        key: 'lark, june',
        name: 'Lark, June',
        detail: 'Namesakes need a choice. Notes and tags stay with the person you match.',
        needsCategory: true,
        kind: 'namesake',
        matchOptions: [
          { memberId: 'm-june', label: 'June Lark' },
          { memberId: 'm-junel', label: 'June L. Lark' },
        ],
      },
    ]);
    expect(resolutionsFor(sample, {})).toEqual({ ready: false, unresolved: 1, resolutions: {} });
    expect(resolutionsFor(sample, { 'lark, june': { action: 'new' } })).toEqual({
      ready: false,
      unresolved: 1,
      resolutions: {},
    });
    expect(resolutionsFor(sample, { 'lark, june': { action: 'match', memberId: 'm-other' } }).ready).toBe(false);
    expect(resolutionsFor(sample, { someone: { action: 'new', category: 'adult' } })).toEqual({
      ready: false,
      unresolved: 1,
      resolutions: {},
    });
    expect(resolutionsFor(sample, { 'lark, june': { action: 'match', memberId: 'm-june' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'lark, june': { action: 'match', memberId: 'm-june' } },
    });
    expect(resolutionsFor(sample, { 'lark, june': { action: 'new', category: 'youth' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'lark, june': { action: 'new', category: 'youth' } },
    });

    const known = preview({
      decisions: [{ ...namesake(), category: 'adult' }],
      needsCategory: ['lark, june'],
    });
    expect(planImportReview(known).rows[0]?.needsCategory).toBe(false);
    expect(resolutionsFor(known, { 'lark, june': { action: 'new' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'lark, june': { action: 'new' } },
    });
  });

  it('a conflict cannot be matched', () => {
    const sample = preview({
      decisions: [
        {
          name: 'Quill, Ada',
          key: 'quill, ada',
          category: 'adult',
          sources: ['organizations', 'without-callings'],
          externalCallings: [],
          kind: 'ambiguous',
          reason: 'report_conflict',
          candidates: [{ memberId: 'm-ada', name: 'Ada Quill' }],
        },
      ],
    });
    const row = planImportReview(sample).rows[0];

    expect(row).toMatchObject({
      key: 'quill, ada',
      name: 'Quill, Ada',
      detail: 'The reports disagree about this person. They cannot be matched to an existing member.',
      needsCategory: true,
      kind: 'report_conflict',
      matchOptions: [],
    });
    expect(resolutionsFor(sample, { 'quill, ada': { action: 'match', memberId: 'm-ada' } })).toEqual({
      ready: false,
      unresolved: 1,
      resolutions: {},
    });
    expect(resolutionsFor(sample, { 'quill, ada': { action: 'new' } }).ready).toBe(false);
    expect(resolutionsFor(sample, { 'quill, ada': { action: 'new', category: 'youth' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'quill, ada': { action: 'new', category: 'youth' } },
    });
  });

  it('a returning member stays unresolved until return is confirmed', () => {
    const sample = preview({
      decisions: [
        {
          name: 'Moss, Ida',
          key: 'moss, ida',
          category: 'adult',
          sources: ['organizations'],
          externalCallings: [],
          kind: 'matched',
          memberId: 'm-ida',
        },
        namesake(),
        {
          name: 'Kept, Kai',
          key: 'kept, kai',
          category: 'youth',
          sources: ['without-callings'],
          externalCallings: [],
          kind: 'matched',
          memberId: 'm-kai',
        },
      ],
      absent: [{ memberId: 'm-gone', name: 'Gone, Gus' }],
      returning: [{ key: 'moss, ida', memberId: 'm-ida' }],
    });
    const review = planImportReview(sample);

    expect(review.rows.map((row) => row.key)).toEqual(['lark, june', 'moss, ida']);
    expect(review.rows[1]).toMatchObject({
      name: 'Moss, Ida',
      detail: 'This member was removed. Confirm it is the same person returning, or treat them as new.',
      needsCategory: false,
      kind: 'returning',
      matchOptions: [{ memberId: 'm-ida', label: 'Same person returning' }],
    });
    expect(
      resolutionsFor(sample, {
        'lark, june': { action: 'match', memberId: 'm-june' },
        'moss, ida': { action: 'match', memberId: 'm-ida' },
      }).ready,
    ).toBe(false);
    expect(
      resolutionsFor(sample, {
        'lark, june': { action: 'match', memberId: 'm-junel' },
        'moss, ida': { action: 'match', memberId: 'm-ida', confirmReturn: true },
      }),
    ).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: {
        'lark, june': { action: 'match', memberId: 'm-junel' },
        'moss, ida': { action: 'match', memberId: 'm-ida', confirmReturn: true },
      },
    });
    expect(
      resolutionsFor(sample, {
        'lark, june': { action: 'match', memberId: 'm-june' },
        'moss, ida': { action: 'match', memberId: 'm-other', confirmReturn: true },
      }).ready,
    ).toBe(false);

    const open = preview({
      decisions: [
        {
          name: 'Moss, Ida',
          key: 'moss, ida',
          category: null,
          sources: ['organizations'],
          externalCallings: [],
          kind: 'matched',
          memberId: 'm-ida',
        },
      ],
      returning: [{ key: 'moss, ida', memberId: 'm-ida' }],
    });
    expect(planImportReview(open).rows[0]?.needsCategory).toBe(true);
    expect(resolutionsFor(open, { 'moss, ida': { action: 'new' } }).ready).toBe(false);
    expect(resolutionsFor(open, { 'moss, ida': { action: 'new', category: 'adult' } }).ready).toBe(true);

    const already = preview({
      decisions: [namesake()],
      returning: [{ key: 'lark, june', memberId: 'm-june' }],
    });
    expect(planImportReview(already).rows.map((row) => row.kind)).toEqual(['namesake']);
    expect(resolutionsFor(already, { 'lark, june': { action: 'match', memberId: 'm-june' } }).ready).toBe(true);
  });

  it('a duplicate report keeps replace off', () => {
    const sample = preview({
      decisions: [namesake()],
      duplicates: ['organizations', 'out-of-unit'],
      inconsistentReports: true,
    });
    const review = planImportReview(sample);
    const resolved = resolutionsFor(sample, { 'lark, june': { action: 'match', memberId: 'm-june' } });

    expect(review.blocked).toBe('duplicate_report');
    expect(review.sources.map((source) => source.status)).toEqual([
      'Duplicate report',
      'Validated',
      'Duplicate report',
      'Not collected yet',
    ]);
    expect(resolved.unresolved).toBe(0);
    expect(resolved.ready).toBe(false);
    expect(resolved.resolutions).toEqual({ 'lark, june': { action: 'match', memberId: 'm-june' } });
  });

  it('disagreeing reports keep replace off', () => {
    const sample = preview({ inconsistentReports: true, duplicates: [] });

    expect(planImportReview(sample).blocked).toBe('inconsistent_reports');
    expect(resolutionsFor(sample, {})).toEqual({ ready: false, unresolved: 0, resolutions: {} });
  });

  it('a category-only new person needs adult or youth', () => {
    const sample = preview({
      decisions: [
        {
          name: 'New, Nora',
          key: 'new, nora',
          category: null,
          sources: ['without-callings'],
          externalCallings: [],
          kind: 'new',
        },
        {
          name: 'Listed, Lena',
          key: 'listed, lena',
          category: 'adult',
          sources: ['organizations'],
          externalCallings: [],
          kind: 'new',
        },
      ],
      needsCategory: ['listed, lena'],
    });
    const review = planImportReview(sample);

    expect(review.rows).toEqual([
      {
        key: 'listed, lena',
        name: 'Listed, Lena',
        detail: 'Choose adult or youth. Age is not stored.',
        needsCategory: true,
        kind: 'new',
        matchOptions: [],
      },
    ]);
    expect(resolutionsFor(sample, { 'listed, lena': { action: 'new' } }).ready).toBe(false);
    expect(resolutionsFor(sample, { 'listed, lena': { action: 'match', memberId: 'm-lena' } }).ready).toBe(false);
    expect(resolutionsFor(sample, { 'listed, lena': { action: 'new', category: 'youth' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'listed, lena': { action: 'new', category: 'youth' } },
    });
  });

  it('a resemblance keeps the known category on treat-as-new', () => {
    const sample = preview({
      decisions: [
        {
          name: 'Pineda, Otto',
          key: 'pineda, otto',
          category: 'adult',
          sources: ['organizations'],
          externalCallings: [],
          kind: 'ambiguous',
          reason: 'resembles',
          candidates: [{ memberId: 'm-otto', name: 'Otto Pineda' }],
        },
      ],
    });

    expect(planImportReview(sample).rows[0]).toMatchObject({
      detail: 'Similar to an existing member. Notes and tags stay only if you match them.',
      needsCategory: false,
      kind: 'resembles',
      matchOptions: [{ memberId: 'm-otto', label: 'Otto Pineda' }],
    });
    expect(resolutionsFor(sample, { 'pineda, otto': { action: 'new' } })).toEqual({
      ready: true,
      unresolved: 0,
      resolutions: { 'pineda, otto': { action: 'new' } },
    });
  });
});
