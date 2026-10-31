import type { Board, BoardGroupKey, IdGenerator, Ward } from '@wardboard/core';
import type { PersonDecision, ReportKind } from '@wardboard/importer';

export type ImportResolution =
  | { readonly action: 'match'; readonly memberId: string; readonly confirmReturn?: true }
  | { readonly action: 'new'; readonly category?: 'adult' | 'youth'; readonly gender?: 'M' | 'F' };

export type ImportResolutions = Readonly<Record<string, ImportResolution>>;

export type ImportFingerprints = {
  readonly organizations: string;
  readonly 'without-callings': string;
  readonly 'out-of-unit': string;
};

export type StructureRef =
  | { readonly kind: 'existing'; readonly id: string }
  | { readonly kind: 'new'; readonly tempId: string };

export type PlannedCreation =
  | {
      readonly kind: 'boardGroup';
      readonly tempId: string;
      readonly name: string;
      readonly key: BoardGroupKey | null;
      readonly order: number;
    }
  | {
      readonly kind: 'callingGroup';
      readonly tempId: string;
      readonly name: string;
      readonly parent: StructureRef;
      readonly order: number;
    }
  | {
      readonly kind: 'assignment';
      readonly tempId: string;
      readonly title: string;
      readonly organization: string;
      readonly type: 'single' | 'list';
      readonly group: StructureRef;
      readonly order: number;
    }
  | {
      readonly kind: 'position';
      readonly tempId: string;
      readonly assignment: StructureRef;
      readonly order: number;
    };

export type PlannedRow = {
  readonly organization: string;
  readonly group: string;
  readonly title: string;
  readonly occupant: string | null;
  readonly decisionKey: string | null;
  readonly conflict: boolean;
  readonly position: StructureRef;
  readonly assignment: StructureRef;
  readonly assignmentType: 'single' | 'list';
};

export type ImportPlan = {
  readonly decisions: readonly PersonDecision[];
  readonly absent: readonly { readonly memberId: string; readonly name: string }[];
  readonly duplicates: readonly ReportKind[];
  readonly inconsistentReports: boolean;
  readonly returning: readonly { readonly key: string; readonly memberId: string }[];
  readonly needsCategory: readonly string[];
  readonly needsGender: readonly string[];
  readonly unfamiliar: readonly { readonly organization: string; readonly group: string; readonly title: string; readonly vacant: boolean }[];
  readonly keptPositions: number;
  readonly matchedPositions: number;
  readonly reportDate: string;
  readonly fingerprints: ImportFingerprints;
  readonly currentVersion: number;
  readonly rows: readonly PlannedRow[];
  readonly creations: readonly PlannedCreation[];
  readonly ward: Ward;
  readonly current: Board;
};

export type ApplyImportResult =
  | {
      readonly ok: true;
      readonly ward: Ward;
      readonly current: Board;
      readonly importVersion: string;
      readonly importedAt: string;
      readonly matched: number;
      readonly created: number;
      readonly removed: number;
    }
  | { readonly ok: false; readonly error: 'duplicate_report' | 'inconsistent_reports' | 'unresolved' }
  | { readonly ok: false; readonly error: 'stale'; readonly currentVersion: number };

export type ApplyImportInput = {
  readonly plan: ImportPlan;
  readonly resolutions: ImportResolutions;
  readonly expectedVersion: number;
  readonly ids: IdGenerator;
  readonly clock: () => Date;
};
