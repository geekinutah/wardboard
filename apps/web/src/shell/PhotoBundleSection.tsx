import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import type { Ward } from '@wardboard/core';
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

const COLLECTION_URL = '/api/admin/photo-collection';
const CONTINUE_URL = '/api/admin/photo-collection/continue';
const CANCEL_URL = '/api/admin/photo-collection/cancel';
const SIGN_IN =
  'Sign in on the computer running WardBoard, in the window that opens there. A phone does not show that window. WardBoard never asks for your password.';
const UNAVAILABLE = 'Directory collection is not available on this server.';
const CONNECTION = 'Unable to connect to server. Check your connection.';
const COLLECTED_CLEANUP = 'Temporary collection files on this computer were removed.';

export interface PhotoBundleSectionProps {
  readonly fetchImpl?: typeof fetch;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}

type Step = 'select' | 'matches' | 'review' | 'done';
type BundleSource = 'files' | 'collection';
type CollectionPhase = 'idle' | 'running' | 'needs-sign-in' | 'review' | 'failed';
type CancelMode = 'cleanup' | 'dismiss';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCurrent(mounted: { current: boolean }, generation: { current: number }, gen: number): boolean {
  return mounted.current && generation.current === gen;
}

function readBundle(value: unknown): PhotoBundleResponse | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.portraits) || !Array.isArray(value.missing)) return null;
  if (typeof value.skippedHousehold !== 'number') return null;
  return {
    portraits: value.portraits as PhotoBundleResponse['portraits'],
    missing: value.missing as PhotoBundleResponse['missing'],
    skippedHousehold: value.skippedHousehold,
  };
}

interface CompareReviewItem {
  readonly memberId: string;
  readonly memberName: string;
  readonly currentUrl: string | null;
  readonly incomingUrl: string;
  readonly photoRef: string;
}

function membersForMatching(current: Ward): WardMemberForMatching[] {
  return Object.values(current.members).map((member) => ({
    id: member.id,
    name: member.name,
    photoRef: member.photoRef,
    removedDate: member.removedDate,
  }));
}

function defaultFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  return window.fetch(...args);
}

function defaultSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => {
    clearTimeout(timer);
  };
}

export function PhotoBundleSection({
  fetchImpl = defaultFetch,
  schedule = defaultSchedule,
}: PhotoBundleSectionProps): ReactElement {
  const client = useSyncClient();
  const { ward, me } = useSync();
  const isAdmin = me?.role === 'admin';

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
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [phase, setPhase] = useState<CollectionPhase | null>(null);
  const [progress, setProgress] = useState('');
  const [continuing, setContinuing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [bundleSource, setBundleSource] = useState<BundleSource | null>(null);
  const [rosterReady, setRosterReady] = useState(false);

  const fetchRef = useRef(fetchImpl);
  const scheduleRef = useRef(schedule);
  const wardRef = useRef(ward);
  const stopTimer = useRef<(() => void) | null>(null);
  const generation = useRef<number>(0);
  const mounted = useRef<boolean>(true);
  const continueLock = useRef<boolean>(false);
  const cancelLock = useRef<boolean>(false);
  const cleanupSent = useRef<boolean>(false);
  const collectLock = useRef<boolean>(false);
  const sourceRef = useRef<BundleSource | null>(null);
  const stepRef = useRef<Step>('select');
  const readCollectionRef = useRef<() => Promise<void>>(async () => {});
  const pendingRoster = useRef<boolean>(false);
  const heldBundle = useRef<PhotoBundleResponse | null>(null);

  fetchRef.current = fetchImpl;
  scheduleRef.current = schedule;
  wardRef.current = ward;

  function stopPolling(): void {
    stopTimer.current?.();
    stopTimer.current = null;
  }

  function armPolling(): void {
    stopPolling();
    const cancelTimer = scheduleRef.current(() => {
      stopTimer.current = null;
      void readCollectionRef.current();
    }, 1000);
    stopTimer.current = cancelTimer;
  }

  function goToStep(next: Step): void {
    stepRef.current = next;
    setStep(next);
  }

  function setSource(next: BundleSource | null): void {
    sourceRef.current = next;
    setBundleSource(next);
  }

  function openBundle(bundle: PhotoBundleResponse, source: BundleSource): void {
    const current = wardRef.current;
    heldBundle.current = bundle;
    setSource(source);
    setBundleResponse(bundle);
    setSelections({});
    setDuplicateTargetError(false);
    setLoading(false);
    if (current === null) {
      pendingRoster.current = true;
      setRosterReady(false);
      setMatches([]);
      goToStep('matches');
      return;
    }
    pendingRoster.current = false;
    setRosterReady(true);
    setMatches(matchBundlePortraits(membersForMatching(current), bundle.portraits));
    goToStep('matches');
  }

  async function postCancel(mode: CancelMode): Promise<void> {
    if (cleanupSent.current || cancelLock.current) return;
    cleanupSent.current = true;
    cancelLock.current = true;
    stopPolling();
    generation.current += 1;
    try {
      const response = await fetchRef.current(CANCEL_URL, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!mounted.current) return;
      if (!response.ok) {
        if (mode === 'dismiss') setError(CONNECTION);
        return;
      }
      if (mode === 'dismiss') {
        setError(null);
        setPhase('idle');
        setProgress('');
        setContinuing(false);
        continueLock.current = false;
        setSource(null);
        goToStep('select');
      }
    } catch {
      if (mounted.current && mode === 'dismiss') setError(CONNECTION);
    } finally {
      cancelLock.current = false;
    }
  }

  function applyView(body: unknown): void {
    if (!isRecord(body) || typeof body.status !== 'string') {
      stopPolling();
      setError(CONNECTION);
      setPhase('idle');
      return;
    }
    const reported = typeof body.progress === 'string' ? body.progress : '';
    if (body.status === 'running' || body.status === 'needs-sign-in') {
      setError(null);
      setPhase(body.status);
      setProgress(reported);
      continueLock.current = false;
      setContinuing(false);
      armPolling();
      return;
    }
    stopPolling();
    if (body.status === 'idle') {
      setPhase('idle');
      setProgress('');
      continueLock.current = false;
      setContinuing(false);
      return;
    }
    if (body.status === 'review') {
      const bundle = readBundle(body.bundle);
      if (bundle === null) {
        setError(CONNECTION);
        setPhase('idle');
        return;
      }
      if (sourceRef.current === 'files') return;
      setError(null);
      setPhase('review');
      setProgress(reported);
      continueLock.current = false;
      setContinuing(false);
      openBundle(bundle, 'collection');
      return;
    }
    if (body.status === 'failed') {
      const message = typeof body.message === 'string' && body.message.length > 0 ? body.message : CONNECTION;
      setPhase('failed');
      setProgress('');
      setError(message);
      continueLock.current = false;
      setContinuing(false);
      void postCancel('cleanup');
      return;
    }
    setError(CONNECTION);
    setPhase('idle');
  }

  readCollectionRef.current = async (): Promise<void> => {
    const gen = ++generation.current;
    let response: Response;
    try {
      response = await fetchRef.current(COLLECTION_URL, {
        method: 'GET',
        credentials: 'same-origin',
      });
    } catch {
      if (!isCurrent(mounted, generation, gen)) return;
      stopPolling();
      setError(CONNECTION);
      setPhase('idle');
      return;
    }
    if (!isCurrent(mounted, generation, gen)) return;
    if (response.status === 503) {
      stopPolling();
      setError(UNAVAILABLE);
      setPhase('idle');
      return;
    }
    if (!response.ok) {
      stopPolling();
      setError(CONNECTION);
      setPhase('idle');
      return;
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      if (!isCurrent(mounted, generation, gen)) return;
      stopPolling();
      setError(CONNECTION);
      setPhase('idle');
      return;
    }
    if (!isCurrent(mounted, generation, gen)) return;
    applyView(parsed);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTimer.current?.();
      stopTimer.current = null;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (me?.role !== 'admin') return;
    void readCollectionRef.current();
    return () => {
      stopTimer.current?.();
      stopTimer.current = null;
      generation.current += 1;
    };
  }, [me?.role]);

  useEffect(() => {
    if (ward === null || !pendingRoster.current) return;
    const bundle = heldBundle.current;
    if (bundle === null) return;
    pendingRoster.current = false;
    setRosterReady(true);
    setMatches(matchBundlePortraits(membersForMatching(ward), bundle.portraits));
    setSelections({});
    setDuplicateTargetError(false);
  }, [ward]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const chosen = e.target.files ? Array.from(e.target.files) : [];
    setFiles(chosen);
    setError(null);
  }

  function finishCollected(): void {
    goToStep('done');
    if (sourceRef.current === 'collection') void postCancel('cleanup');
  }

  function handleStartOver(): void {
    const collected = sourceRef.current === 'collection';
    pendingRoster.current = false;
    heldBundle.current = null;
    setRosterReady(false);
    setSource(null);
    goToStep('select');
    setFiles([]);
    setBundleResponse(null);
    setMatches([]);
    setSelections({});
    setDuplicateTargetError(false);
    setError(null);
    setLoading(false);
    setDisclosureOpen(false);
    setCompareItems([]);
    if (collected) {
      setPhase('idle');
      setProgress('');
      void postCancel('dismiss');
    }
  }

  function handleCollect(): void {
    if (collectLock.current) return;
    collectLock.current = true;
    setStarting(true);
    setError(null);
    cleanupSent.current = false;
    stopPolling();
    generation.current += 1;
    void (async () => {
      try {
        const response = await fetchRef.current(COLLECTION_URL, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!mounted.current) return;
        if (response.status === 503) {
          setError(UNAVAILABLE);
          setPhase('idle');
          return;
        }
        if (response.status !== 200 && response.status !== 409) {
          setError(CONNECTION);
          setPhase('idle');
          return;
        }
        await readCollectionRef.current();
      } catch {
        if (!mounted.current) return;
        setError(CONNECTION);
        setPhase('idle');
      } finally {
        collectLock.current = false;
        if (mounted.current) setStarting(false);
      }
    })();
  }

  function handleContinue(): void {
    if (continueLock.current || phase !== 'needs-sign-in') return;
    continueLock.current = true;
    setContinuing(true);
    stopPolling();
    generation.current += 1;
    void (async () => {
      try {
        const response = await fetchRef.current(CONTINUE_URL, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!mounted.current) return;
        if (!response.ok) {
          setError(CONNECTION);
          continueLock.current = false;
          setContinuing(false);
          armPolling();
          return;
        }
        await readCollectionRef.current();
      } catch {
        if (!mounted.current) return;
        setError(CONNECTION);
        continueLock.current = false;
        setContinuing(false);
      }
    })();
  }

  function handleJobCancel(): void {
    if (phase !== 'running' && phase !== 'needs-sign-in') return;
    setPhase('idle');
    setProgress('');
    setContinuing(false);
    continueLock.current = false;
    void postCancel('dismiss');
  }

  async function handleReview(): Promise<void> {
    if (files.length === 0) return;
    stopPolling();
    generation.current += 1;
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

    openBundle(postRes.bundle, 'files');
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
    if (ward === null || !rosterReady) return;
    const resolved = resolveBundleSelections(matches, selections);
    if (!resolved.ok) {
      if (resolved.reason === 'duplicate_target') {
        setDuplicateTargetError(true);
      }
      return;
    }

    setLoading(true);
    const incoming = resolved.incoming;
    const wardMembers: PhotoMember[] = Object.values(ward.members).map((m) => ({
      id: m.id,
      name: m.name,
      photoRef: m.photoRef,
    }));

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
      finishCollected();
      return;
    }

    const compareList: CompareReviewItem[] = [];
    for (const memberId of plan.compare) {
      const inc = incoming.find((i) => i.memberId === memberId);
      if (inc === undefined) continue;
      const currentMember = (ward.members as Record<string, { photoRef: string | null }>)[memberId];
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
    goToStep('review');
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
  const canImport = rosterReady && ward !== null && allAmbiguousSelected && !duplicateTargetError;

  const skippedHousehold = bundleResponse?.skippedHousehold ?? 0;
  const householdNote =
    skippedHousehold > 0
      ? ` · ${String(skippedHousehold)} ${skippedHousehold === 1 ? 'household image' : 'household images'} skipped`
      : '';

  const showCollect = isAdmin && (phase === 'idle' || phase === 'failed');
  const showContinue = isAdmin && phase === 'needs-sign-in';
  const showCancel = isAdmin && (phase === 'running' || phase === 'needs-sign-in');
  const showSignIn = showCollect || showContinue || showCancel;
  const showProgress = isAdmin && (phase === 'running' || phase === 'needs-sign-in');
  const showDisclosure = me !== null;

  return (
    <section className="wb-photo-bundle-section" aria-label="Directory photos">
      <h2 className="wb-photo-bundle-section-title">Directory photos</h2>

      {step === 'select' && (
        <div className="wb-photo-bundle-select-pane">
          <p className="wb-photo-bundle-note">
            Import photos collected from Church directory (<code>manifest.json</code> and portrait images).
          </p>
          {showSignIn && <p className="wb-photo-bundle-signin">{SIGN_IN}</p>}
          {showProgress && (
            <p className="wb-photo-bundle-progress" aria-live="polite">
              {progress}
            </p>
          )}
          {error !== null && (
            <div role="alert" className="wb-photo-bundle-alert">
              {error}
            </div>
          )}
          {(showCollect || showContinue || showCancel) && (
            <div className="wb-photo-bundle-collect-actions">
              {showCollect && (
                <Button variant="primary" disabled={starting} onClick={handleCollect}>
                  Collect from the directory
                </Button>
              )}
              {showContinue && (
                <Button variant="primary" disabled={continuing} onClick={handleContinue}>
                  Continue
                </Button>
              )}
              {showCancel && (
                <Button variant="secondary" onClick={handleJobCancel}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          {showDisclosure && (
            <Button
              variant="secondary"
              className="wb-photo-bundle-disclosure"
              aria-expanded={disclosureOpen}
              onClick={() => {
                setDisclosureOpen((open) => !open);
              }}
            >
              Import an existing bundle
            </Button>
          )}
          {showDisclosure && (
            <div hidden={!disclosureOpen}>
              {disclosureOpen && (
              <div className="wb-photo-bundle-file-panel">
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
            </div>
          )}
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
              if (index >= compareItems.length - 1) finishCollected();
            }}
            onKeep={(index: number) => {
              setKeptCount((c) => c + 1);
              if (index >= compareItems.length - 1) finishCollected();
            }}
            onCancel={() => {
              finishCollected();
            }}
          />
        </div>
      )}

      {step === 'done' && (
        <div className="wb-photo-bundle-done-pane">
          <p className="wb-photo-bundle-summary">
            Imported directory photos: {appliedCount} added, {replacedCount} replaced, {keptCount} kept.
          </p>
          {bundleSource === 'collection' ? (
            <p className="wb-photo-bundle-summary">{COLLECTED_CLEANUP}</p>
          ) : (
            <div className="wb-photo-bundle-cleanup-card">
              <p className="wb-photo-bundle-cleanup-title">
                Clean up the temporary collector staging folder on your computer:
              </p>
              <pre className="wb-photo-bundle-cleanup-code">
                <code>pnpm --filter @wardboard/collector run collect -- --staging &lt;staging-dir&gt; --cleanup</code>
              </pre>
            </div>
          )}
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
