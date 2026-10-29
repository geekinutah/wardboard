export interface PhotoBundleManifestPortrait {
  readonly name: string;
  readonly file: string;
  readonly duplicateName: boolean;
}

export interface PhotoBundleManifestMissing {
  readonly name: string;
  readonly reason: 'none' | 'household';
}

export interface PhotoBundleManifest {
  readonly format: 'wardboard-photo-bundle';
  readonly version: 1;
  readonly layoutVersion: string;
  readonly portraits: readonly PhotoBundleManifestPortrait[];
  readonly missing: readonly PhotoBundleManifestMissing[];
  readonly skippedHousehold: number;
}

export interface PhotoBundleRequest {
  readonly manifest: PhotoBundleManifest;
  readonly files: Readonly<Record<string, string>>;
}

export interface UploadedBundlePortrait {
  readonly name: string;
  readonly file: string;
  readonly photoRef: string;
  readonly duplicateName: boolean;
}

export interface PhotoBundleResponse {
  readonly portraits: readonly UploadedBundlePortrait[];
  readonly missing: readonly PhotoBundleManifestMissing[];
  readonly skippedHousehold: number;
}

export interface BundleCandidateMember {
  readonly memberId: string;
  readonly name: string;
  readonly photoRef: string | null;
}

export type BundlePortraitMatch =
  | {
      readonly kind: 'matched';
      readonly index: number;
      readonly name: string;
      readonly file: string;
      readonly photoRef: string;
      readonly member: BundleCandidateMember;
    }
  | {
      readonly kind: 'ambiguous';
      readonly index: number;
      readonly name: string;
      readonly file: string;
      readonly photoRef: string;
      readonly candidates: readonly BundleCandidateMember[];
    }
  | {
      readonly kind: 'unmatched';
      readonly index: number;
      readonly name: string;
      readonly file: string;
      readonly photoRef: string;
    };

export interface WardMemberForMatching {
  readonly id: string;
  readonly name: string;
  readonly canonicalName?: string;
  readonly photoRef: string | null;
  readonly removedDate: string | null;
}

export interface IncomingMemberPhoto {
  readonly memberId: string;
  readonly photoRef: string;
  readonly memberName: string;
}

export function normalizeBundleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function matchBundlePortraits(
  members: readonly WardMemberForMatching[],
  portraits: readonly UploadedBundlePortrait[],
): readonly BundlePortraitMatch[] {
  const activeMembers = members.filter((m) => m.removedDate === null);
  const membersByName = new Map<string, BundleCandidateMember[]>();

  for (const m of activeMembers) {
    const norm = normalizeBundleName(m.canonicalName ?? m.name);
    const list = membersByName.get(norm) ?? [];
    list.push({ memberId: m.id, name: m.name, photoRef: m.photoRef });
    membersByName.set(norm, list);
  }

  for (const list of membersByName.values()) {
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      if (cmp !== 0) return cmp;
      return a.memberId.localeCompare(b.memberId);
    });
  }

  const portraitNameCounts = new Map<string, number>();
  for (const p of portraits) {
    const norm = normalizeBundleName(p.name);
    portraitNameCounts.set(norm, (portraitNameCounts.get(norm) ?? 0) + 1);
  }

  return portraits.map((p, index): BundlePortraitMatch => {
    const norm = normalizeBundleName(p.name);
    const matchingMembers = membersByName.get(norm) ?? [];

    if (matchingMembers.length === 0) {
      return {
        kind: 'unmatched',
        index,
        name: p.name,
        file: p.file,
        photoRef: p.photoRef,
      };
    }

    const firstCandidate = matchingMembers[0];
    if (
      matchingMembers.length === 1 &&
      firstCandidate !== undefined &&
      !p.duplicateName &&
      (portraitNameCounts.get(norm) ?? 0) === 1
    ) {
      return {
        kind: 'matched',
        index,
        name: p.name,
        file: p.file,
        photoRef: p.photoRef,
        member: firstCandidate,
      };
    }

    return {
      kind: 'ambiguous',
      index,
      name: p.name,
      file: p.file,
      photoRef: p.photoRef,
      candidates: matchingMembers,
    };
  });
}

export type ResolveBundleSelectionsResult =
  | { readonly ok: true; readonly incoming: readonly IncomingMemberPhoto[] }
  | { readonly ok: false; readonly reason: 'unresolved' | 'duplicate_target' };

export function resolveBundleSelections(
  matches: readonly BundlePortraitMatch[],
  selections: Readonly<Record<number, string>>,
): ResolveBundleSelectionsResult {
  for (const match of matches) {
    if (match.kind === 'ambiguous') {
      const sel = selections[match.index];
      if (!sel) return { ok: false, reason: 'unresolved' };
    }
  }

  const targets = new Set<string>();
  for (const match of matches) {
    if (match.kind === 'matched') {
      if (targets.has(match.member.memberId)) {
        return { ok: false, reason: 'duplicate_target' };
      }
      targets.add(match.member.memberId);
    } else if (match.kind === 'ambiguous') {
      const sel = selections[match.index];
      if (sel && sel !== 'skip') {
        if (targets.has(sel)) {
          return { ok: false, reason: 'duplicate_target' };
        }
        targets.add(sel);
      }
    }
  }

  const incoming: IncomingMemberPhoto[] = [];
  for (const match of matches) {
    if (match.kind === 'matched') {
      incoming.push({
        memberId: match.member.memberId,
        photoRef: match.photoRef,
        memberName: match.member.name,
      });
    } else if (match.kind === 'ambiguous') {
      const sel = selections[match.index];
      if (sel && sel !== 'skip') {
        const candidate = match.candidates.find((c) => c.memberId === sel);
        incoming.push({
          memberId: sel,
          photoRef: match.photoRef,
          memberName: candidate?.name ?? match.name,
        });
      }
    }
  }

  return { ok: true, incoming };
}

export type ReadBundleResult =
  | { readonly ok: true; readonly payload: PhotoBundleRequest }
  | { readonly ok: false; readonly message: string };

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  return btoa(binary);
}

function isManifest(val: unknown): val is PhotoBundleManifest {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.format === 'wardboard-photo-bundle' &&
    obj.version === 1 &&
    typeof obj.layoutVersion === 'string' &&
    Array.isArray(obj.portraits) &&
    Array.isArray(obj.missing) &&
    typeof obj.skippedHousehold === 'number'
  );
}

export async function readBundleFiles(files: Iterable<File>): Promise<ReadBundleResult> {
  const fileArray = Array.from(files);
  const manifestFile = fileArray.find((f) => f.name === 'manifest.json');
  if (!manifestFile) {
    return {
      ok: false,
      message: "Select manifest.json and every portrait image from the collector's bundle folder.",
    };
  }

  let parsed: unknown;
  try {
    const text = await manifestFile.text();
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      message: "Select manifest.json and every portrait image from the collector's bundle folder.",
    };
  }

  if (!isManifest(parsed)) {
    return {
      ok: false,
      message: "Select manifest.json and every portrait image from the collector's bundle folder.",
    };
  }
  const manifest = parsed;

  const fileMap = new Map<string, File>();
  for (const f of fileArray) {
    fileMap.set(f.name, f);
  }

  const filesRecord: Record<string, string> = {};
  for (const portrait of manifest.portraits) {
    const f = fileMap.get(portrait.file);
    if (f === undefined) {
      return {
        ok: false,
        message: "Select manifest.json and every portrait image from the collector's bundle folder.",
      };
    }
  }

  for (const portrait of manifest.portraits) {
    const f = fileMap.get(portrait.file);
    if (f !== undefined) {
      filesRecord[portrait.file] = await fileToBase64(f);
    }
  }

  return {
    ok: true,
    payload: {
      manifest,
      files: filesRecord,
    },
  };
}

export type PostBundleResult =
  | { readonly ok: true; readonly bundle: PhotoBundleResponse }
  | { readonly ok: false; readonly code: 'forbidden' | 'too_large' | 'invalid_bundle' | 'offline' };

export async function postPhotoBundle(
  fetchImpl: typeof fetch,
  payload: PhotoBundleRequest,
): Promise<PostBundleResult> {
  try {
    const res = await fetchImpl('/api/photos/bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (res.status === 200) {
      const bundle = (await res.json()) as PhotoBundleResponse;
      return { ok: true, bundle };
    }
    if (res.status === 403) return { ok: false, code: 'forbidden' };
    if (res.status === 413) return { ok: false, code: 'too_large' };
    if (res.status === 400) return { ok: false, code: 'invalid_bundle' };
    return { ok: false, code: 'offline' };
  } catch {
    return { ok: false, code: 'offline' };
  }
}
