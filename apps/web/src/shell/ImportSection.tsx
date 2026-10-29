import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button } from '../design/Button.tsx';
import {
  postImportPreview,
  postImportReplace,
  readReportFiles,
  type ImportFetch,
  type ImportPreviewFailure,
  type ImportReportFiles,
} from '../features/import/client.ts';
import { ImportReview, type ImportReplaceHandler } from '../features/import/ImportReview.tsx';
import type { ImportPreview } from '../features/import/plan.ts';
import { useSync } from '../sync/react.tsx';
import './import-section.css';

type ReportField = 'organizations' | 'withoutCallings' | 'outOfUnit';

const FIELDS: readonly { field: ReportField; label: string; hint: string }[] = [
  {
    field: 'organizations',
    label: 'Organizations and callings',
    hint: 'In LCR: Callings → Callings by Organization → Print → Download PDF. Choose Callings only, without Members or Ministering, if offered.',
  },
  {
    field: 'withoutCallings',
    label: 'Members without callings',
    hint: 'In LCR: Reports → Members without Callings → Print → Download PDF.',
  },
  {
    field: 'outOfUnit',
    label: 'Out-of-unit callings',
    hint: 'In LCR: Reports → Out-of-Unit Callings → Print → Download PDF.',
  },
];

const READ_FAILURE = "Those files couldn't be read as the three LCR reports.";

const FAILURE_MESSAGES: Record<ImportPreviewFailure, string> = {
  forbidden: 'Only admins can import.',
  too_large: 'Those files are too large to import.',
  bad_request: READ_FAILURE,
  offline: "The import couldn't reach the server.",
};

type Picked = Partial<Record<ReportField, File>>;

type Review = { readonly preview: ImportPreview; readonly encoded: ImportReportFiles };

function defaultFetch(...args: Parameters<ImportFetch>): ReturnType<ImportFetch> {
  return window.fetch(...args);
}

/** The Settings "Import" section (SPEC §8): three reports in, the T-059 review, then replace. Admin only. */
export function ImportSection({ fetchImpl = defaultFetch }: { fetchImpl?: ImportFetch }): ReactElement {
  const { boards } = useSync();
  const headingId = useId();
  const baseId = useId();
  const [picked, setPicked] = useState<Picked>({});
  const [inputGeneration, setInputGeneration] = useState(0);
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const current = boards?.current ?? null;
  // With no Current the first import creates it, against version 0 (SPEC §8).
  const expectedVersion = current === null ? 0 : current.version;

  const organizations = picked.organizations;
  const withoutCallings = picked.withoutCallings;
  const outOfUnit = picked.outOfUnit;
  const ready = organizations !== undefined && withoutCallings !== undefined && outOfUnit !== undefined;

  function onPick(field: ReportField, event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    setPicked((previous) => ({ ...previous, [field]: file }));
    setFailure(null);
  }

  async function runPreview(): Promise<void> {
    if (organizations === undefined || withoutCallings === undefined || outOfUnit === undefined || reading) return;
    setReading(true);
    setFailure(null);
    try {
      let encoded: ImportReportFiles;
      try {
        encoded = await readReportFiles({ organizations, withoutCallings, outOfUnit });
      } catch {
        setFailure(READ_FAILURE);
        return;
      }
      const result = await postImportPreview(fetchImpl, encoded);
      if (result.ok) setReview({ preview: result.preview, encoded });
      else setFailure(FAILURE_MESSAGES[result.code]);
    } finally {
      setReading(false);
    }
  }

  function startOver(): void {
    setPicked({});
    setFailure(null);
    setReview(null);
    setInputGeneration((generation) => generation + 1);
  }

  const onReplace: ImportReplaceHandler = (input) => {
    if (review === null) return Promise.resolve({ ok: false, code: 'bad_request' });
    return postImportReplace(fetchImpl, { ...review.encoded, ...input });
  };

  let body: ReactElement;
  if (review !== null && boards !== null) {
    body = (
      <>
        <div className="wb-import-section-actions">
          <Button variant="secondary" onClick={startOver}>
            Start over
          </Button>
        </div>
        <ImportReview preview={review.preview} expectedVersion={expectedVersion} onReplace={onReplace} />
      </>
    );
  } else {
    body = (
      <>
        <div className="wb-import-section-files" key={inputGeneration}>
          {FIELDS.map(({ field, label, hint }) => {
            const id = `${baseId}-${field}`;
            const hintId = `${id}-hint`;
            const file = picked[field];
            return (
              <div key={field} className="wb-import-section-file">
                <label htmlFor={id} className="wb-import-section-label">
                  {label}
                </label>
                <p id={hintId} className="wb-import-section-hint">
                  {hint}
                </p>
                <input
                  id={id}
                  aria-describedby={hintId}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="wb-import-section-input"
                  onChange={(event) => {
                    onPick(field, event);
                  }}
                />
                {file === undefined ? null : <span className="wb-import-section-name">{file.name}</span>}
              </div>
            );
          })}
        </div>
        <details className="wb-import-section-howto">
          <summary className="wb-import-section-howto-summary">How to get these reports</summary>
          <ol className="wb-import-section-steps">
            <li>Sign in to LCR in your own browser. WardBoard never asks for your Church password or MFA code.</li>
            <li>Download the three reports above and keep them in a private folder.</li>
            <li>Choose each file here, then press Preview import. Nothing changes until you confirm.</li>
          </ol>
          <p className="wb-import-section-guide">The full guide is docs/import/guide.md in the WardBoard repository.</p>
        </details>
        {failure === null ? null : (
          <p className="wb-import-section-error" role="alert">
            {failure}
          </p>
        )}
        <div className="wb-import-section-actions">
          <Button
            disabled={!ready || reading}
            onClick={() => {
              void runPreview();
            }}
          >
            {reading ? 'Reading reports…' : 'Preview import'}
          </Button>
        </div>
      </>
    );
  }

  return (
    <section className="wb-import-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="wb-import-section-title">
        Import
      </h2>
      <p className="wb-import-section-note">
        {current === null
          ? 'Create Current from the three LCR reports. Nothing changes until you confirm.'
          : 'Replace Current with the three LCR reports. Nothing changes until you confirm.'}
      </p>
      {body}
    </section>
  );
}
