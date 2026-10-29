import { describe, expect, it } from 'vitest';
import {
  matchBundlePortraits,
  normalizeBundleName,
  readBundleFiles,
  resolveBundleSelections,
  type BundlePortraitMatch,
  type UploadedBundlePortrait,
  type WardMemberForMatching,
} from './bundle.ts';

describe('normalizeBundleName', () => {
  it('trims and collapses whitespace and lowercases', () => {
    expect(normalizeBundleName('  Ada   Lovelace  ')).toBe('ada lovelace');
    expect(normalizeBundleName('ALICE\t\nSMITH')).toBe('alice smith');
  });
});

describe('matchBundlePortraits', () => {
  it('matches unique active ward members case-insensitively and ignores removed members', () => {
    const members: readonly WardMemberForMatching[] = [
      { id: 'm-1', name: 'Ada Lovelace', photoRef: null, removedDate: null },
      { id: 'm-2', name: 'Bob Smith', photoRef: 'bob.jpg', removedDate: '2026-01-01' },
      { id: 'm-3', name: 'Bob Smith', photoRef: null, removedDate: null },
    ];
    const portraits: readonly UploadedBundlePortrait[] = [
      { name: 'ada   lovelace', file: 'ada.png', photoRef: 'ada-ref.png', duplicateName: false },
      { name: 'Bob SMITH', file: 'bob.jpg', photoRef: 'bob-ref.jpg', duplicateName: false },
      { name: 'Unknown Person', file: 'unk.jpg', photoRef: 'unk-ref.jpg', duplicateName: false },
    ];

    const matches = matchBundlePortraits(members, portraits);
    expect(matches).toEqual([
      {
        kind: 'matched',
        index: 0,
        name: 'ada   lovelace',
        file: 'ada.png',
        photoRef: 'ada-ref.png',
        member: { memberId: 'm-1', name: 'Ada Lovelace', photoRef: null },
      },
      {
        kind: 'matched',
        index: 1,
        name: 'Bob SMITH',
        file: 'bob.jpg',
        photoRef: 'bob-ref.jpg',
        member: { memberId: 'm-3', name: 'Bob Smith', photoRef: null },
      },
      {
        kind: 'unmatched',
        index: 2,
        name: 'Unknown Person',
        file: 'unk.jpg',
        photoRef: 'unk-ref.jpg',
      },
    ]);
  });

  it('marks duplicateName entries from the manifest as ambiguous even when the ward has one member with that name', () => {
    const members: readonly WardMemberForMatching[] = [
      { id: 'm-1', name: 'Jane Doe', photoRef: null, removedDate: null },
      { id: 'm-2', name: 'John Public', photoRef: null, removedDate: null },
    ];
    const portraits: readonly UploadedBundlePortrait[] = [
      // 1. One member in ward, but portrait has duplicateName: true
      { name: 'Jane Doe', file: 'jane.png', photoRef: 'jane-ref.png', duplicateName: true },
      // 2. Two portraits in bundle sharing a name
      { name: 'John Public', file: 'john1.png', photoRef: 'john1-ref.png', duplicateName: false },
      { name: 'John Public', file: 'john2.png', photoRef: 'john2-ref.png', duplicateName: false },
    ];

    const matches = matchBundlePortraits(members, portraits);
    expect(matches[0]).toMatchObject({
      kind: 'ambiguous',
      index: 0,
      candidates: [{ memberId: 'm-1', name: 'Jane Doe' }],
    });
    expect(matches[1]).toMatchObject({
      kind: 'ambiguous',
      index: 1,
      candidates: [{ memberId: 'm-2', name: 'John Public' }],
    });
    expect(matches[2]).toMatchObject({
      kind: 'ambiguous',
      index: 2,
      candidates: [{ memberId: 'm-2', name: 'John Public' }],
    });
  });

  it('marks multiple active ward members with the same name as ambiguous with all candidates', () => {
    const members: readonly WardMemberForMatching[] = [
      { id: 'm-2', name: 'Chris Evans', photoRef: 'chris2.jpg', removedDate: null },
      { id: 'm-1', name: 'Chris Evans', photoRef: null, removedDate: null },
    ];
    const portraits: readonly UploadedBundlePortrait[] = [
      { name: 'Chris Evans', file: 'chris.jpg', photoRef: 'chris-ref.jpg', duplicateName: false },
    ];

    const matches = matchBundlePortraits(members, portraits);
    expect(matches).toEqual([
      {
        kind: 'ambiguous',
        index: 0,
        name: 'Chris Evans',
        file: 'chris.jpg',
        photoRef: 'chris-ref.jpg',
        candidates: [
          { memberId: 'm-1', name: 'Chris Evans', photoRef: null },
          { memberId: 'm-2', name: 'Chris Evans', photoRef: 'chris2.jpg' },
        ],
      },
    ]);
  });
});

describe('resolveBundleSelections', () => {
  it('resolveBundleSelections rejects unresolved or duplicate targets and preserves order when valid', () => {
    const matches: readonly BundlePortraitMatch[] = [
      {
        kind: 'matched',
        index: 0,
        name: 'Ada Lovelace',
        file: 'ada.png',
        photoRef: 'ada-ref.png',
        member: { memberId: 'm-1', name: 'Ada Lovelace', photoRef: null },
      },
      {
        kind: 'ambiguous',
        index: 1,
        name: 'Chris Evans',
        file: 'chris1.png',
        photoRef: 'chris1-ref.png',
        candidates: [
          { memberId: 'm-2', name: 'Chris Evans', photoRef: null },
          { memberId: 'm-3', name: 'Chris Evans', photoRef: null },
        ],
      },
      {
        kind: 'ambiguous',
        index: 2,
        name: 'Chris Evans 2',
        file: 'chris2.png',
        photoRef: 'chris2-ref.png',
        candidates: [
          { memberId: 'm-2', name: 'Chris Evans', photoRef: null },
          { memberId: 'm-3', name: 'Chris Evans', photoRef: null },
        ],
      },
      {
        kind: 'unmatched',
        index: 3,
        name: 'Ghost Member',
        file: 'ghost.png',
        photoRef: 'ghost-ref.png',
      },
    ];

    // 1. Unresolved ambiguous row
    expect(resolveBundleSelections(matches, {})).toEqual({ ok: false, reason: 'unresolved' });
    expect(resolveBundleSelections(matches, { 1: 'm-2' })).toEqual({ ok: false, reason: 'unresolved' });

    // 2. Duplicate target (both resolved to m-2)
    expect(resolveBundleSelections(matches, { 1: 'm-2', 2: 'm-2' })).toEqual({
      ok: false,
      reason: 'duplicate_target',
    });
    // Duplicate target with matched row (resolved to m-1, which matches row 0)
    expect(
      resolveBundleSelections(matches, {
        1: 'm-1',
        2: 'm-3',
      }),
    ).toEqual({
      ok: false,
      reason: 'duplicate_target',
    });

    // 3. Valid resolution with 'skip'
    const validWithSkip = resolveBundleSelections(matches, { 1: 'm-2', 2: 'skip' });
    expect(validWithSkip).toEqual({
      ok: true,
      incoming: [
        { memberId: 'm-1', photoRef: 'ada-ref.png', memberName: 'Ada Lovelace' },
        { memberId: 'm-2', photoRef: 'chris1-ref.png', memberName: 'Chris Evans' },
      ],
    });

    // 4. Valid resolution assigning both candidates
    const validAll = resolveBundleSelections(matches, { 1: 'm-2', 2: 'm-3' });
    expect(validAll).toEqual({
      ok: true,
      incoming: [
        { memberId: 'm-1', photoRef: 'ada-ref.png', memberName: 'Ada Lovelace' },
        { memberId: 'm-2', photoRef: 'chris1-ref.png', memberName: 'Chris Evans' },
        { memberId: 'm-3', photoRef: 'chris2-ref.png', memberName: 'Chris Evans' },
      ],
    });
  });
});

describe('readBundleFiles', () => {
  it('readBundleFiles requires manifest.json and every referenced portrait file', async () => {
    // Missing manifest.json
    const noManifest = [new File(['foo'], 'photo.png', { type: 'image/png' })];
    const missingManifestRes = await readBundleFiles(noManifest);
    expect(missingManifestRes).toEqual({
      ok: false,
      message: "Select manifest.json and every portrait image from the collector's bundle folder.",
    });

    // Missing referenced portrait
    const manifest = {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [{ name: 'Test Person', file: 'abc.png', duplicateName: false }],
      missing: [],
      skippedHousehold: 0,
    };
    const missingPhotoFiles = [
      new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
    ];
    const missingPhotoRes = await readBundleFiles(missingPhotoFiles);
    expect(missingPhotoRes).toEqual({
      ok: false,
      message: "Select manifest.json and every portrait image from the collector's bundle folder.",
    });

    // Valid bundle with all files
    const validFiles = [
      new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
      new File([new Uint8Array([1, 2, 3])], 'abc.png', { type: 'image/png' }),
    ];
    const validRes = await readBundleFiles(validFiles);
    expect(validRes.ok).toBe(true);
    if (validRes.ok) {
      expect(validRes.payload.manifest.portraits).toHaveLength(1);
      expect(validRes.payload.files['abc.png']).toBeDefined();
    }
  });
});
