import { useState, type ReactElement } from 'react';
import { acceptedSummary, type SummaryGroup, type Ward } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import type { RequestResult } from '../../sync/protocol.ts';
import { AcceptedView } from './AcceptedView.tsx';
import { acceptBlockReasons } from './acceptance.ts';

/*
 * Preview scenario for the accepted-proposal view (artboard 26): the harness
 * proposal starts Accepted by a fictional login, alongside two older
 * fictional entries. `/__preview/accepted?blocked=1` adds a removed member and
 * a needs-approval placement, so reopening to Draft shows why accepting is
 * refused.
 */

const PREVIEW_LOGIN = 'mike.s';
const PREVIEW_ACCEPTED_AT = '2026-10-26T18:00:00Z';

const OTHER_ENTRIES = [
  { id: 'preview-summer', name: 'Summer youth leaders', acceptedAt: '2026-07-12T18:00:00Z' },
  { id: 'preview-eq', name: 'Elders Quorum reorganization', acceptedAt: '2026-04-03T18:00:00Z' },
];

function blockedWard(data: PreviewData): Ward {
  const { ward, proposal } = data;
  const members = { ...ward.members };
  const placed = Object.values(proposal.board.placements);
  const baselinePlaced = new Set(Object.values(proposal.baseline.placements));
  const approvalId = placed.find((id) => !baselinePlaced.has(id));
  const removedId = placed.find((id) => baselinePlaced.has(id));
  if (approvalId !== undefined && members[approvalId] !== undefined) {
    members[approvalId] = { ...members[approvalId], needsApproval: true };
  }
  if (removedId !== undefined && members[removedId] !== undefined) {
    members[removedId] = { ...members[removedId], removedDate: '2026-10-24' };
  }
  return { ...ward, members };
}

function AcceptedPreviewBody({ data }: { data: PreviewData }): ReactElement {
  const blocked = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('blocked');
  const ward = blocked ? blockedWard(data) : data.ward;
  const { proposal, current } = data;

  const [summary, setSummary] = useState<SummaryGroup[] | null>(() => [...acceptedSummary(proposal, ward)]);
  const [selectedId, setSelectedId] = useState<string>(proposal.id);

  const accepted = summary !== null;
  const history = [
    ...(accepted ? [{ id: proposal.id, name: proposal.name, acceptedAt: PREVIEW_ACCEPTED_AT }] : []),
    ...OTHER_ENTRIES,
  ];

  const other = OTHER_ENTRIES.find((entry) => entry.id === selectedId);
  const view =
    other !== undefined
      ? {
          name: other.name,
          status: 'accepted' as const,
          accepted: { byLogin: PREVIEW_LOGIN, at: other.acceptedAt, summary: [] },
        }
      : {
          name: proposal.name,
          status: accepted ? ('accepted' as const) : ('draft' as const),
          accepted: accepted ? { byLogin: PREVIEW_LOGIN, at: PREVIEW_ACCEPTED_AT, summary } : null,
        };

  const onSetStatus = (status: 'draft' | 'accepted'): Promise<RequestResult> => {
    setSummary(status === 'draft' ? null : [...acceptedSummary(proposal, ward)]);
    return Promise.resolve({ ok: true } as RequestResult);
  };

  return (
    <AcceptedView
      history={history}
      selectedId={selectedId}
      proposal={view}
      blockReasons={view.status === 'draft' ? acceptBlockReasons(proposal, current, ward) : []}
      onSelect={setSelectedId}
      onSetStatus={onSetStatus}
      copy={(text) => navigator.clipboard.writeText(text)}
      onExit={() => undefined}
    />
  );
}

const preview: PreviewModule = {
  title: 'Accepted proposal',
  render: (data) => <AcceptedPreviewBody data={data} />,
};

export default preview;
