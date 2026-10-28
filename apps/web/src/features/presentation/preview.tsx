import type { ReactElement } from 'react';
import { wardOverview, type Board, type MemberId, type Ward } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { Presentation, type PresentationProps } from './Presentation.tsx';

function isFilledMember(memberId: MemberId | null): memberId is MemberId {
  return memberId !== null;
}

/** The fixture's needs-approval member is not a leader. Flag one visible leader so the setting can be seen. */
function wardWithNeedsApprovalLeader(ward: Ward, board: Board): Ward {
  const filled = wardOverview(board, null)
    .flatMap((tile) => tile.leaders)
    .map((leader) => leader.memberId)
    .filter(isFilledMember);
  const already = filled.some((memberId) => ward.members[memberId]?.needsApproval === true);
  if (already) {
    return ward;
  }
  const targetId = filled[0];
  if (targetId === undefined) {
    return ward;
  }
  const member = ward.members[targetId];
  if (member === undefined) {
    return ward;
  }
  return {
    ...ward,
    members: {
      ...ward.members,
      [targetId]: { ...member, needsApproval: true },
    },
  };
}

function exitPreview(): void {
  return undefined;
}

function PresentationPreview(data: PreviewData): ReactElement {
  const ward = wardWithNeedsApprovalLeader(data.ward, data.proposal.board);
  const shared: Omit<PresentationProps, 'showNeedsApproval'> = {
    board: data.proposal.board,
    ward,
    baseline: data.proposal.baseline,
    title: data.proposal.name,
    status: data.proposal.status,
    baselineCapturedAt: data.proposal.createdAt,
    onExit: exitPreview,
  };

  return (
    <div className="wb-presentation-preview">
      <section className="wb-presentation-preview-case">
        <h2 className="wb-presentation-preview-label">Show Needs approval off</h2>
        <Presentation {...shared} showNeedsApproval={false} />
      </section>
      <section className="wb-presentation-preview-case">
        <h2 className="wb-presentation-preview-label">Show Needs approval on</h2>
        <Presentation {...shared} showNeedsApproval />
      </section>
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Presentation',
  render: PresentationPreview,
};

export default preview;
