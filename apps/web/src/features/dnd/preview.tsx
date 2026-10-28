import { useState, type ReactElement } from 'react';
import {
  approvePlacement,
  positionId,
  releaseCalling,
  sequentialIds,
  userId,
  type Board,
  type CallingGroupId,
  type MemberId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { DugoutPanel } from '../dugout/DugoutPanel.tsx';
import { GroupDetail } from '../group-view/GroupDetail.tsx';
import { DndSurface } from './DndSurface.tsx';
import { dropContext, runDropOp } from './resolve.ts';
import type { DropOp } from './types.ts';
import './dnd.css';

const APPROVED_BY = userId('u-preview');
const APPROVED_AT = '2026-01-04T12:00:00Z';
const ME = { displayName: 'Preview Editor' } as const;

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`preview member ${name} not found`);
  }
  return found.id;
}

function groupNamed(board: Board, name: string): CallingGroupId {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`preview calling group ${name} not found`);
  }
  return found.id;
}

/** The calling group holding `member`'s position titled `title`. */
function groupHolding(board: Board, member: MemberId, title: string): CallingGroupId {
  for (const [position, occupant] of Object.entries(board.placements)) {
    if (occupant !== member) continue;
    const slot = board.positions[positionId(position)];
    const assignment = slot === undefined ? undefined : board.assignments[slot.assignmentId];
    if (assignment?.title === title) {
      return assignment.groupId;
    }
  }
  throw new Error(`preview: no ${title} position held by ${member}`);
}

/**
 * The shared preview data places Ivy Notreal in the Relief Society Teachers
 * vacancy. This preview needs her back in the dugout and that vacancy open, so
 * it releases her callings locally with core.
 */
function startingProposal(data: PreviewData): Proposal {
  const ivy = memberNamed(data.ward, 'Ivy Notreal');
  let board = data.proposal.board;
  for (const [position, occupant] of Object.entries(board.placements)) {
    if (occupant !== ivy) continue;
    const result = releaseCalling(board, { ward: data.ward, ids: sequentialIds('dnd-start') }, {
      memberId: ivy,
      positionId: positionId(position),
    });
    if (!result.ok) {
      throw new Error(`preview setup failed: ${result.error.message}`);
    }
    board = result.board;
  }
  return { ...data.proposal, board };
}

function applyOp(proposal: Proposal, ward: Ward, op: DropOp): Board {
  const board = proposal.board;
  const result =
    op.kind === 'approvePlacement'
      ? approvePlacement(board, { ward, ids: sequentialIds('dnd-approve') }, {
          baseline: proposal.baseline,
          memberId: op.request.memberId,
          positionId: op.request.positionId,
          approvedBy: APPROVED_BY,
          approvedAt: APPROVED_AT,
        })
      : runDropOp(board, dropContext(board, ward), op);
  if (!result.ok) {
    throw new Error(`preview could not apply ${op.kind}: ${result.error.message}`);
  }
  return result.board;
}

const noop = (): void => undefined;

function DndPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [proposal, setProposal] = useState<Proposal>(() => startingProposal(data));
  const [showCurrent, setShowCurrent] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const board = showCurrent ? data.current : proposal.board;
  const baseline = showCurrent ? null : proposal.baseline;
  const kai = memberNamed(data.ward, 'Kai Fictional');
  const groups = {
    presidency: groupNamed(board, 'Relief Society Presidency'),
    teachers: groupNamed(board, 'Relief Society Teachers'),
    // Found on the starting board: Cy may be dragged out of it later.
    primary: groupHolding(data.proposal.board, memberNamed(data.ward, 'Cy Mockup'), 'Primary Teacher'),
  };

  function commit(ops: readonly DropOp[]): void {
    let next = proposal;
    for (const op of ops) {
      next = { ...next, board: applyOp(next, data.ward, op) };
    }
    setProposal(next);
    setApplied(ops.map((op) => op.kind).join(', '));
  }

  function group(id: CallingGroupId, area: string): ReactElement {
    return (
      <div className={`wb-dnd-preview-cell wb-dnd-preview-${area}`}>
        <GroupDetail
          board={board}
          ward={data.ward}
          baseline={baseline}
          callingGroupId={id}
          // Adding positions is not part of this preview; keep the views compact.
          readOnly
          onAddPosition={noop}
          onAddGroup={noop}
        />
      </div>
    );
  }

  return (
    <div className="wb-dnd-preview">
      <div className="wb-dnd-preview-bar">
        <button
          type="button"
          className="wb-button wb-button-secondary"
          aria-pressed={showCurrent}
          onClick={() => {
            setShowCurrent((value) => !value);
          }}
        >
          Show Current
        </button>
        <p className="wb-dnd-preview-status" role="status">
          {showCurrent ? 'Current is read-only. Nothing can be dragged here.' : null}
          {!showCurrent && applied !== null ? `Applied: ${applied}` : null}
          {!showCurrent && applied === null ? 'Drag a member card onto a calling or the dugout.' : null}
        </p>
        {opened === null ? null : <p className="wb-dnd-preview-status">{`Would open ${opened}`}</p>}
      </div>
      <DndSurface
        key={showCurrent ? 'current' : 'proposal'}
        board={board}
        ward={data.ward}
        proposal={showCurrent ? null : proposal}
        me={ME}
        readOnly={showCurrent}
        onCommit={commit}
        onHoverOpen={setOpened}
      >
        <div className="wb-dnd-preview-grid">
          {group(groups.presidency, 'presidency')}
          {group(groups.primary, 'primary')}
          {group(groups.teachers, 'teachers')}
          <section className="wb-dnd-preview-cell wb-dnd-preview-outside" aria-labelledby="wb-dnd-preview-outside">
            <h2 id="wb-dnd-preview-outside" className="wb-dnd-preview-heading">
              Out-of-Unit
            </h2>
            <article className="wb-dnd-preview-member" data-member-id={kai}>
              <span className="wb-dnd-preview-name">Kai Fictional</span>
              <span className="wb-dnd-preview-detail">Stake Young Single Adult Adviser · Example Stake</span>
            </article>
          </section>
          <div className="wb-dnd-preview-cell wb-dnd-preview-dugout">
            <DugoutPanel board={board} ward={data.ward} />
          </div>
        </div>
      </DndSurface>
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Drag and drop',
  render: (data) => <DndPreview data={data} />,
};

export default preview;
