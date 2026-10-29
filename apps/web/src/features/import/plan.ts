export type ReportKind = 'organizations' | 'without-callings' | 'out-of-unit';

export type PersonDecision = {
  readonly name: string;
  readonly key: string;
  readonly category: 'adult' | 'youth' | null;
  readonly sources: readonly ReportKind[];
  readonly externalCallings: readonly {
    readonly section: string;
    readonly calling: string;
    readonly servingUnit: string | null;
  }[];
} & (
  | { readonly kind: 'matched'; readonly memberId: string }
  | { readonly kind: 'new' }
  | {
      readonly kind: 'ambiguous';
      readonly reason: 'namesake' | 'resembles' | 'report_conflict';
      readonly candidates: readonly { readonly memberId: string; readonly name: string }[];
    }
);

export type ImportPreview = {
  readonly decisions: readonly PersonDecision[];
  readonly absent: readonly { readonly memberId: string; readonly name: string }[];
  readonly duplicates: readonly ReportKind[];
  readonly inconsistentReports: boolean;
  readonly returning: readonly { readonly key: string; readonly memberId: string }[];
  readonly needsCategory: readonly string[];
  readonly unfamiliar: readonly {
    readonly organization: string;
    readonly group: string;
    readonly title: string;
    readonly vacant: boolean;
  }[];
  readonly keptPositions: number;
  readonly matchedPositions: number;
};

export type ImportResolution =
  | { readonly action: 'match'; readonly memberId: string; readonly confirmReturn?: true }
  | { readonly action: 'new'; readonly category?: 'adult' | 'youth' };

export type ImportRowKind = 'namesake' | 'resembles' | 'report_conflict' | 'returning' | 'new';

export type ImportMatchOption = {
  readonly memberId: string;
  readonly label: string;
};

export type ImportReviewRow = {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  readonly needsCategory: boolean;
  readonly kind: ImportRowKind;
  readonly matchOptions: readonly ImportMatchOption[];
};

export type ImportSourceStatus = 'Validated' | 'Duplicate report' | 'Not collected yet';

export type ImportSourceCard = {
  readonly name: string;
  readonly detail: string;
  readonly status: ImportSourceStatus;
};

export type ImportStat = {
  readonly label: string;
  readonly value: number;
};

export type ImportBlocked = 'duplicate_report' | 'inconsistent_reports' | null;

export type ImportReview = {
  readonly sources: readonly ImportSourceCard[];
  readonly stats: readonly ImportStat[];
  readonly blocked: ImportBlocked;
  readonly rows: readonly ImportReviewRow[];
};

const REPORT_SOURCES: readonly { readonly kind: ReportKind; readonly name: string }[] = [
  { kind: 'organizations', name: 'Callings by Organization' },
  { kind: 'without-callings', name: 'Members without Callings' },
  { kind: 'out-of-unit', name: 'Out-of-Unit Callings' },
];

const NAMESAKE_DETAIL = 'Namesakes need a choice. Notes and tags stay with the person you match.';
const RESEMBLES_DETAIL = 'Similar to an existing member. Notes and tags stay only if you match them.';
const CONFLICT_DETAIL = 'The reports disagree about this person. They cannot be matched to an existing member.';
const RETURNING_DETAIL = 'This member was removed. Confirm it is the same person returning, or treat them as new.';
const CATEGORY_DETAIL = 'Choose adult or youth. Age is not stored.';

function blockedOf(preview: ImportPreview): ImportBlocked {
  if (preview.duplicates.length > 0) return 'duplicate_report';
  if (preview.inconsistentReports) return 'inconsistent_reports';
  return null;
}

function sourcesOf(preview: ImportPreview): ImportSourceCard[] {
  const duplicates = new Set(preview.duplicates);
  const sources: ImportSourceCard[] = REPORT_SOURCES.map((source) => ({
    name: source.name,
    detail: 'Included in this preview',
    status: duplicates.has(source.kind) ? 'Duplicate report' : 'Validated',
  }));
  sources.push({
    name: 'Directory photos',
    detail: 'Optional · upload in the app or collect later',
    status: 'Not collected yet',
  });
  return sources;
}

function outsideWard(preview: ImportPreview): number {
  let total = 0;
  for (const decision of preview.decisions) total += decision.externalCallings.length;
  return total;
}

function candidateOptions(
  candidates: readonly { readonly memberId: string; readonly name: string }[],
): ImportMatchOption[] {
  return candidates.map((candidate) => ({ memberId: candidate.memberId, label: candidate.name }));
}

function ambiguousRow(decision: PersonDecision & { readonly kind: 'ambiguous' }): ImportReviewRow {
  if (decision.reason === 'namesake') {
    return {
      key: decision.key,
      name: decision.name,
      detail: NAMESAKE_DETAIL,
      needsCategory: decision.category === null,
      kind: 'namesake',
      matchOptions: candidateOptions(decision.candidates),
    };
  }
  if (decision.reason === 'resembles') {
    return {
      key: decision.key,
      name: decision.name,
      detail: RESEMBLES_DETAIL,
      needsCategory: decision.category === null,
      kind: 'resembles',
      matchOptions: candidateOptions(decision.candidates),
    };
  }
  return {
    key: decision.key,
    name: decision.name,
    detail: CONFLICT_DETAIL,
    needsCategory: true,
    kind: 'report_conflict',
    matchOptions: [],
  };
}

// Ambiguous and category-only rows follow decision order. Returning rows come after, unless that key already has a row.
function decisionRows(preview: ImportPreview): ImportReviewRow[] {
  const needsCategory = new Set(preview.needsCategory);
  const rows: ImportReviewRow[] = [];
  const seen = new Set<string>();

  for (const decision of preview.decisions) {
    if (seen.has(decision.key)) continue;
    if (decision.kind === 'ambiguous') {
      rows.push(ambiguousRow(decision));
      seen.add(decision.key);
      continue;
    }
    if (decision.kind === 'new' && needsCategory.has(decision.key)) {
      rows.push({
        key: decision.key,
        name: decision.name,
        detail: CATEGORY_DETAIL,
        needsCategory: true,
        kind: 'new',
        matchOptions: [],
      });
      seen.add(decision.key);
    }
  }

  const byKey = new Map(preview.decisions.map((decision) => [decision.key, decision]));
  for (const item of preview.returning) {
    if (seen.has(item.key)) continue;
    const decision = byKey.get(item.key);
    if (decision === undefined || decision.kind !== 'matched') continue;
    rows.push({
      key: decision.key,
      name: decision.name,
      detail: RETURNING_DETAIL,
      needsCategory: decision.category === null,
      kind: 'returning',
      matchOptions: [{ memberId: item.memberId, label: 'Same person returning' }],
    });
    seen.add(item.key);
  }

  return rows;
}

export function planImportReview(preview: ImportPreview): ImportReview {
  return {
    sources: sourcesOf(preview),
    stats: [
      { label: 'People', value: preview.decisions.length },
      { label: 'Matched positions', value: preview.matchedPositions },
      { label: 'Kept positions', value: preview.keptPositions },
      { label: 'Outside-ward callings', value: outsideWard(preview) },
      { label: 'Unfamiliar callings', value: preview.unfamiliar.length },
    ],
    blocked: blockedOf(preview),
    rows: decisionRows(preview),
  };
}

function isCategory(value: string | undefined): value is 'adult' | 'youth' {
  return value === 'adult' || value === 'youth';
}

function asNew(row: ImportReviewRow, choice: ImportResolution): ImportResolution | null {
  if (choice.action !== 'new') return null;
  if (row.needsCategory) {
    if (!isCategory(choice.category)) return null;
    return { action: 'new', category: choice.category };
  }
  if (choice.category !== undefined) return null;
  return { action: 'new' };
}

function normalize(row: ImportReviewRow, choice: ImportResolution | undefined): ImportResolution | null {
  if (choice === undefined) return null;
  switch (row.kind) {
    case 'namesake':
    case 'resembles': {
      if (choice.action === 'match') {
        const listed = row.matchOptions.some((option) => option.memberId === choice.memberId);
        if (!listed) return null;
        return { action: 'match', memberId: choice.memberId };
      }
      return asNew(row, choice);
    }
    case 'report_conflict':
    case 'new':
      return asNew(row, choice);
    case 'returning': {
      if (choice.action === 'match') {
        const option = row.matchOptions[0];
        if (option === undefined || choice.memberId !== option.memberId || choice.confirmReturn !== true) return null;
        return { action: 'match', memberId: choice.memberId, confirmReturn: true };
      }
      return asNew(row, choice);
    }
  }
}

export function resolutionsFor(
  preview: ImportPreview,
  choices: Readonly<Record<string, ImportResolution>>,
): { ready: boolean; unresolved: number; resolutions: Record<string, ImportResolution> } {
  const review = planImportReview(preview);
  const resolutions: Record<string, ImportResolution> = {};
  let unresolved = 0;
  for (const row of review.rows) {
    const resolution = normalize(row, choices[row.key]);
    if (resolution === null) unresolved += 1;
    else resolutions[row.key] = resolution;
  }
  return {
    ready: unresolved === 0 && review.blocked === null,
    unresolved,
    resolutions,
  };
}
