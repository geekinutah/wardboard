import { useState, type ReactElement } from 'react';
import type { PreviewModule } from '../../preview/types.ts';
import { CurrentReadOnlyBar } from './CurrentReadOnlyBar.tsx';
import {
  StartProposalDialog,
  type CreateProposalRequest,
  type StartProposalChoice,
} from './StartProposalDialog.tsx';

const IMPORTED_AT = '2026-10-24T15:00:00.000Z';

const PREVIEW_PROPOSALS: readonly StartProposalChoice[] = [
  { id: 'preview-spring', name: 'Spring adjustments', status: 'draft', tabOrder: 1 },
  { id: 'preview-youth', name: 'Youth focus', status: 'accepted', tabOrder: 2 },
];

function createdStatus(request: CreateProposalRequest): string {
  const chosen = request.source;
  if (chosen.kind === 'current') {
    return `Created “${request.name}” from Current`;
  }
  const source = PREVIEW_PROPOSALS.find((proposal) => proposal.id === chosen.proposalId);
  const sourceName = source === undefined ? chosen.proposalId : source.name;
  return `Created “${request.name}” as a duplicate of “${sourceName}”`;
}

function ProposalsPreview(): ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="wb-proposals-preview">
      <CurrentReadOnlyBar
        importedAt={IMPORTED_AT}
        onStartProposal={() => {
          setOpen(true);
        }}
      />
      {status === null ? null : (
        <p className="wb-proposals-status" role="status">
          {status}
        </p>
      )}
      {open ? (
        <StartProposalDialog
          importedAt={IMPORTED_AT}
          proposals={PREVIEW_PROPOSALS}
          onCreate={(request) => {
            setStatus(createdStatus(request));
            return Promise.resolve({ ok: true });
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Start proposal',
  render: () => <ProposalsPreview />,
};

export default preview;
