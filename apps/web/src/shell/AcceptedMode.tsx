import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Board, Proposal, Ward } from '@wardboard/core';
import { AcceptedView } from '../features/accepted/AcceptedView.tsx';
import { acceptBlockReasons, sortHistory } from '../features/accepted/acceptance.ts';
import type { ProposalDetailView, ProposalView, RequestResult } from '../sync/protocol.ts';
import { useSync, useSyncClient } from '../sync/react.tsx';

export interface AcceptedModeProps {
  /** The open proposal's id, or null when opened from Current (newest accepted is selected). */
  readonly openedFromProposalId: string | null;
  readonly proposal: ProposalView | null;
  readonly baseline: Board | null;
  readonly board: Board | null;
  readonly ward: Ward | null;
  readonly current: Board | null;
  readonly onExit: () => void;
}

const LOADING_CURRENT = 'Loading Current…';

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function AcceptedMode({
  openedFromProposalId,
  proposal: view,
  baseline,
  board,
  ward,
  current,
  onExit,
}: AcceptedModeProps): ReactElement {
  const client = useSyncClient();
  const { boards } = useSync();

  const history = useMemo(
    () =>
      (boards?.proposals ?? []).flatMap((item) =>
        item.status === 'accepted' && typeof item.acceptedAt === 'string'
          ? [{ id: item.id, name: item.name, acceptedAt: item.acceptedAt }]
          : [],
      ),
    [boards],
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    () => openedFromProposalId ?? sortHistory(history)[0]?.id ?? null,
  );
  const [loaded, setLoaded] = useState<{ id: string; detail: ProposalDetailView } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  // Refetch whenever the selection or its boards entry (version, status, acceptedAt) changes.
  const entry = boards?.proposals.find((item) => item.id === selectedId);
  const entryKey = entry === undefined ? '' : `${String(entry.version)}|${entry.status}|${entry.acceptedAt ?? ''}`;

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    void client.getProposal(selectedId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLoaded({ id: selectedId, detail: result.proposal });
        setFailure(null);
      } else {
        setFailure({ id: selectedId, message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, selectedId, entryKey]);

  const onSetStatus = useCallback(
    async (status: 'draft' | 'accepted'): Promise<RequestResult> => {
      if (selectedId === null) return { ok: false, code: 'no_selection', message: 'No proposal selected' };
      const result = await client.setProposalStatus(selectedId, status);
      if (!result.ok) return result;
      return { ok: true } as RequestResult;
    },
    [client, selectedId],
  );

  const detail = loaded !== null && loaded.id === selectedId ? loaded.detail : null;
  const refusal = failure !== null && failure.id === selectedId ? failure.message : null;

  let blockReasons: string[] = [];
  if (view !== null && selectedId === view.id && view.status === 'draft') {
    if (current === null || baseline === null || board === null || ward === null) {
      blockReasons = [LOADING_CURRENT];
    } else {
      const core: Proposal = {
        id: view.id,
        name: view.name,
        status: view.status,
        rationale: view.rationale,
        accepted: null,
        tabOrder: 0,
        createdAt: '',
        updatedAt: '',
        baseline,
        board,
      };
      blockReasons = acceptBlockReasons(core, current, ward);
    }
  }

  if (selectedId !== null && detail === null && refusal === null) {
    return (
      <div className="shell-body">
        <p className="shell-loading">Loading…</p>
      </div>
    );
  }

  return (
    <>
      {refusal === null ? null : <p role="alert">{refusal}</p>}
      <AcceptedView
        history={history}
        selectedId={selectedId}
        proposal={
          detail === null ? null : { name: detail.name, status: detail.status, accepted: detail.accepted }
        }
        blockReasons={blockReasons}
        onSelect={setSelectedId}
        onSetStatus={onSetStatus}
        copy={copyToClipboard}
        onExit={onExit}
      />
    </>
  );
}
