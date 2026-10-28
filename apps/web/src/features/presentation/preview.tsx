import type { ReactElement } from 'react';
import {
  dugout,
  placeInPosition,
  sequentialIds,
  wardOverview,
  type Board,
  type MemberId,
  type OverviewLeader,
  type Ward,
} from '@wardboard/core';
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

/**
 * Vacant prominent leaders, fewest-per-tile first, so the Proposed line fits the TV card.
 * Ties break by tile name, then role, then position id.
 */
function vacantProminentLeaders(board: Board, baseline: Board): readonly OverviewLeader[] {
  const tiles = wardOverview(board, baseline)
    .slice()
    .sort(
      (left, right) =>
        left.leaders.length - right.leaders.length || left.name.localeCompare(right.name, 'en'),
    );
  const leaders: OverviewLeader[] = [];
  for (const tile of tiles) {
    const vacant = tile.leaders.filter((leader) => leader.memberId === null);
    vacant.sort(
      (left, right) =>
        left.title.localeCompare(right.title, 'en') || left.positionId.localeCompare(right.positionId, 'en'),
    );
    leaders.push(...vacant);
  }
  return leaders;
}

/**
 * The fixture's only prominent change is a release, which renders as Vacant.
 * Place one dugout member into a vacant prominent single so core marks that leader proposed.
 */
function boardWithProposedLeader(board: Board, baseline: Board | null, ward: Ward): Board {
  if (baseline === null) {
    throw new Error('Presentation preview has no baseline, so no leader can be marked proposed');
  }
  const already = wardOverview(board, baseline).some((tile) =>
    tile.leaders.some((leader) => leader.proposed && leader.memberId !== null),
  );
  if (already) {
    return board;
  }

  const member = dugout(board, ward).find((entry) => entry.callings.length === 0);
  if (member === undefined) {
    throw new Error('Presentation preview has no unplaced dugout member to propose');
  }

  const ctx = { ward, ids: sequentialIds('presentation-preview') };
  let failure = 'no vacant prominent single leader';
  for (const target of vacantProminentLeaders(board, baseline)) {
    const position = board.positions[target.positionId];
    const assignment = position === undefined ? undefined : board.assignments[position.assignmentId];
    if (position === undefined || assignment === undefined || assignment.type !== 'single' || !assignment.enabled) {
      continue;
    }
    const result = placeInPosition(board, ctx, { memberId: member.memberId, from: null, to: target.positionId });
    if (!result.ok) {
      failure = result.error.message;
      continue;
    }
    const proposed = wardOverview(result.board, baseline).some((tile) =>
      tile.leaders.some(
        (leader) =>
          leader.proposed && leader.memberId === member.memberId && leader.positionId === target.positionId,
      ),
    );
    if (!proposed) {
      failure = `placement into ${target.title} was not a proposed overview leader`;
      continue;
    }
    return result.board;
  }
  throw new Error(`Presentation preview could not mark a proposed leader: ${failure}`);
}

function exitPreview(): void {
  return undefined;
}

function PresentationPreview(data: PreviewData): ReactElement {
  const board = boardWithProposedLeader(data.proposal.board, data.proposal.baseline, data.ward);
  const ward = wardWithNeedsApprovalLeader(data.ward, board);
  const shared: Omit<PresentationProps, 'showNeedsApproval'> = {
    board,
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
