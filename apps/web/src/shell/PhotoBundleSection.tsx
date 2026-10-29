import { useState, type ChangeEvent, type ReactElement } from 'react';
import { Button } from '../design/Button.tsx';
import { assignPhoto } from '../features/photos/assignPhoto.ts';
import {
  matchBundlePortraits,
  postPhotoBundle,
  readBundleFiles,
  resolveBundleSelections,
  type BundlePortraitMatch,
  type PhotoBundleResponse,
  type WardMemberForMatching,
} from '../features/photos/bundle.ts';
import { PhotoBatchReview } from '../features/photos/PhotoBatchReview.tsx';
import { planPhotoBatch, type PhotoMember } from '../features/photos/plan.ts';
import { useSync, useSyncClient } from '../sync/react.tsx';
import './photo-bundle-section.css';

export interface PhotoBundleSectionProps {
  readonly fetchImpl?: typeof fetch;
}

type Step = 'select' | 'matches' | 'review' | 'done';

interface CompareReviewItem {
  readonly memberId: string;
  readonly memberName: string;
  readonly currentUrl: string | null;
  readonly incomingUrl: string;
  readonly photoRef: string;
}

function defaultFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  return window.fetch(...args);
}

export function PhotoBundleSection({ fetchImpl = defaultFetch }: PhotoBundleSectionProps): ReactElement {
  const client = useSyncClient();
  const { ward } = useSync();

  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bundleResponse, setBundleResponse] = useState<PhotoBundleResponse | null>(null);
  const [matches, setMatches] = useState<readonly BundlePortraitMatch[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [duplicateTargetError, setDuplicateTargetError] = useState(false);

  const [compareItems, setCompareItems] = useState<readonly CompareReviewItem[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const [replacedCount, setReplacedCount] = useState(0);
  const [keptCount, setKeptCount] = useState(0);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const chosen = e.target.files ? Array.from(e.target.files) : [];
    setFiles(chosen);
    setError(null);
  }

  function handleStartOver(): void {
    setStep('select');
    setFiles([]);
    setBundleResponse(null);
    setMatches([]);
    setSelections({});
    setDuplicateTargetError(false);
    setError(null);
    setLoading(false);
  }

  async function handleReview(): Promise<void> {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);

    const readRes = await readBundleFiles(files);
    if (!readRes.ok) {
      setError(readRes.message);
      setLoading(false);
      return;
    }

    const postRes = await postPhotoBundle(fetchImpl, readRes.payload);
    if (!postRes.ok) {
      if (postRes.code === 'forbidden') {
        setError('Only editors and admins can upload photo bundles.');
      } else if (postRes.code === 'too_large') {
        setError('Photo bundle exceeds maximum allowed size (25 MiB).');
      } else if (postRes.code === 'invalid_bundle') {
        setError('Photo bundle is invalid or contains corrupt files.');
      } else {
        setError("Unable to connect to server. Check your connection.");
      }
      setLoading(false);
      return;
    }

    const wardMembers: WardMemberForMatching[] = ward
      ? Object.values(ward.members).map((m) => ({
          id: m.id,
          name: m.name,
          photoRef: m.photoRef,
          removedDate: m.removedDate,
        }))
      : [];

    const computedMatches = matchBundlePortraits(wardMembers, postRes.bundle.portraits);
    setBundleResponse(postRes.bundle);
    setMatches(computedMatches);
    setSelections({});
    setDuplicateTargetError(false);
    setStep('matches');
    setLoading(false);
  }

  function handleSelectCandidate(index: number, choice: string): void {
    const nextSelections = { ...selections, [index]: choice };
    setSelections(nextSelections);

    const resolved = resolveBundleSelections(matches, nextSelections);
    if (!resolved.ok && resolved.reason === 'duplicate_target') {
      setDuplicateTargetError(true);
    } else {
      setDuplicateTargetError(false);
    }
  }

  async function handleImport(): Promise<void> {
    const resolved = resolveBundleSelections(matches, selections);
    if (!resolved.ok) {
      if (resolved.reason === 'duplicate_target') {
        setDuplicateTargetError(true);
      }
      return;
    }

    setLoading(true);
    const incoming = resolved.incoming;
    const wardMembers: PhotoMember[] = ward
      ? Object.values(ward.members).map((m) => ({
          id: m.id,
          name: m.name,
          photoRef: m.photoRef,
        }))
      : [];

    const plan = planPhotoBatch(wardMembers, incoming);
    if (!plan.ok) {
      setLoading(false);
      return;
    }

    // Apply immediate first photos
    for (const memberId of plan.apply) {
      const inc = incoming.find((i) => i.memberId === memberId);
      if (inc) {
        await assignPhoto(client, memberId, inc.photoRef);
      }
    }

    const applied = plan.apply.length;
    setAppliedCount(applied);
    setReplacedCount(0);
    setKeptCount(0);

    if (plan.compare.length === 0) {
      setLoading(false);
      setStep('done');
      return;
    }

    const compareList: CompareReviewItem[] = [];
    for (const memberId of plan.compare) {
      const inc = incoming.find((i) => i.memberId === memberId);
      if (inc === undefined) continue;
      const currentMember = ward ? (ward.members as Record<string, { photoRef: string | null }>)[memberId] : undefined;
      compareList.push({
        memberId,
        memberName: inc.memberName,
        currentUrl: currentMember?.photoRef ? `/api/photos/${currentMember.photoRef}` : null,
        incomingUrl: `/api/photos/${inc.photoRef}`,
        photoRef: inc.photoRef,
      });
    }

    setCompareItems(compareList);
    setLoading(false);
    setStep('review');
  }

  const ambiguousMatches = matches.filter(
    (m): m is Extract<BundlePortraitMatch, { kind: 'ambiguous' }> => m.kind === 'ambiguous',
  );
  const matchedMatches = matches.filter(
    (m): m is Extract<BundlePortraitMatch, { kind: 'matched' }> => m.kind === 'matched',
  );
  const unmatchedMatches = matches.filter(
    (m): m is Extract<BundlePortraitMatch, { kind: 'unmatched' }> => m.kind === 'unmatched',
  );

  const allAmbiguousSelected = ambiguousMatches.every(
    (m) => selections[m.index] !== undefined && selections[m.index] !== '',
  );
  const canImport = allAmbiguousSelected && !duplicateTargetError;

  const skippedHousehold = bundleResponse?.skippedHousehold ?? 0;
  const householdNote =
    skippedHousehold > 0
      ? ` · ${String(skippedHousehold)} ${skippedHousehold === 1 ? 'household image' : 'household images'} skipped`
      : '';

  return (
    <section className="wb-photo-bundle-section" aria-label="Directory photos">
      <h2 className="wb-photo-bundle-section-title">Directory photos</h2>

      {step === 'select' && (
        <div className="wb-photo-bundle-select-pane">
          <p className="wb-photo-bundle-note">
            Import photos collected from Church directory (<code>manifest.json</code> and portrait images).
          </p>
          <div className="wb-photo-bundle-file-row">
            <label htmlFor="wb-photo-bundle-files" className="wb-photo-bundle-label">
              Photo bundle files
            </label>
            <input
              id="wb-photo-bundle-files"
              type="file"
              multiple
              accept=".json,.jpg,.jpeg,.png"
              className="wb-photo-bundle-input"
              onChange={handleFileChange}
            />
          </div>
          {files.length > 0 && (
            <p className="wb-photo-bundle-file-count">
              {files.length} {files.length === 1 ? 'file' : 'files'} selected
            </p>
          )}
          {error && (
            <div role="alert" className="wb-photo-bundle-alert">
              {error}
            </div>
          )}
          <div className="wb-photo-bundle-actions">
            <Button
              variant="primary"
              disabled={files.length === 0 || loading}
              onClick={() => {
                void handleReview();
              }}
            >
              {loading ? 'Reading bundle…' : 'Review photo bundle'}
            </Button>
          </div>
        </div>
      )}

      {step === 'matches' && (
        <div className="wb-photo-bundle-matches-pane">
          <h3 className="wb-photo-bundle-subheading">Review photo matches</h3>
          <p className="wb-photo-bundle-summary">
            {String(matchedMatches.length)} matched · {String(ambiguousMatches.length)} need confirmation ·{' '}
            {String(unmatchedMatches.length)} unmatched{householdNote}
          </p>

          {duplicateTargetError && (
            <div role="alert" className="wb-photo-bundle-alert">
              Each person can receive at most one photo from the bundle.
            </div>
          )}

          {matchedMatches.length > 0 && (
            <div className="wb-photo-bundle-group">
              <h4 className="wb-photo-bundle-group-title">Matched ({matchedMatches.length})</h4>
              <ul className="wb-photo-bundle-list">
                {matchedMatches.map((m) => (
                  <li key={m.index} className="wb-photo-bundle-item">
                    <span className="wb-photo-bundle-name">{m.name}</span>
                    <span className="wb-photo-bundle-badge">
                      {m.member.photoRef ? 'Replaces existing photo' : 'First photo'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ambiguousMatches.length > 0 && (
            <div className="wb-photo-bundle-group">
              <h4 className="wb-photo-bundle-group-title">
                Need confirmation ({ambiguousMatches.length})
              </h4>
              <ul className="wb-photo-bundle-list">
                {ambiguousMatches.map((m) => {
                  const sel = selections[m.index];
                  return (
                    <li key={m.index} className="wb-photo-bundle-ambiguous-item">
                      <div className="wb-photo-bundle-ambiguous-name">{m.name}</div>
                      <div className="wb-photo-bundle-ambiguous-actions">
                        {m.candidates.map((cand) => (
                          <button
                            key={cand.memberId}
                            type="button"
                            className="wb-photo-bundle-candidate-btn"
                            aria-pressed={sel === cand.memberId}
                            onClick={() => {
                              handleSelectCandidate(m.index, cand.memberId);
                            }}
                          >
                            Assign to {cand.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="wb-photo-bundle-skip-btn"
                          aria-pressed={sel === 'skip'}
                          onClick={() => {
                            handleSelectCandidate(m.index, 'skip');
                          }}
                        >
                          Skip
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {unmatchedMatches.length > 0 && (
            <div className="wb-photo-bundle-group">
              <h4 className="wb-photo-bundle-group-title">Unmatched ({unmatchedMatches.length})</h4>
              <ul className="wb-photo-bundle-list">
                {unmatchedMatches.map((m) => (
                  <li key={m.index} className="wb-photo-bundle-item">
                    <span className="wb-photo-bundle-name">{m.name}</span>
                    <span className="wb-photo-bundle-note">Not in ward — skipped</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="wb-photo-bundle-actions">
            <Button variant="secondary" onClick={handleStartOver}>
              Start over
            </Button>
            <Button
              variant="primary"
              disabled={!canImport || loading}
              onClick={() => {
                void handleImport();
              }}
            >
              {loading ? 'Importing…' : 'Import photos'}
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="wb-photo-bundle-review-pane">
          <PhotoBatchReview
            steps={compareItems.map((item) => ({
              memberName: item.memberName,
              currentUrl: item.currentUrl,
              incomingUrl: item.incomingUrl,
            }))}
            sourceLabel="Directory import"
            skippedHousehold={skippedHousehold}
            onUseNew={(index: number) => {
              const item = compareItems[index];
              if (item) {
                void assignPhoto(client, item.memberId, item.photoRef);
              }
              setReplacedCount((c) => c + 1);
              if (index >= compareItems.length - 1) {
                setStep('done');
              }
            }}
            onKeep={(index: number) => {
              setKeptCount((c) => c + 1);
              if (index >= compareItems.length - 1) {
                setStep('done');
              }
            }}
            onCancel={() => {
              setStep('done');
            }}
          />
        </div>
      )}

      {step === 'done' && (
        <div className="wb-photo-bundle-done-pane">
          <p className="wb-photo-bundle-summary">
            Imported directory photos: {appliedCount} added, {replacedCount} replaced, {keptCount} kept.
          </p>
          <div className="wb-photo-bundle-cleanup-card">
            <p className="wb-photo-bundle-cleanup-title">
              Clean up the temporary collector staging folder on your computer:
            </p>
            <pre className="wb-photo-bundle-cleanup-code">
              <code>pnpm --filter @wardboard/collector run collect -- --staging &lt;staging-dir&gt; --cleanup</code>
            </pre>
          </div>
          <div className="wb-photo-bundle-actions">
            <Button variant="secondary" onClick={handleStartOver}>
              Import another bundle
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
