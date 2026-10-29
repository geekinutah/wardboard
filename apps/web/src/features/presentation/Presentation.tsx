import { useEffect, type ReactElement } from 'react';
import {
  assertNever,
  diffBoards,
  vacancies,
  wardOverview,
  type Board,
  type Member,
  type OverviewLeader,
  type TagId,
  type Ward,
} from '@wardboard/core';
import { avatarColor, displayName, initials } from '../../design/person.ts';
import { Portrait } from '../../design/PersonContent.tsx';
import { photoUrl } from '../photos/upload.ts';
import './presentation.css';

export type PresentationStatus = 'current' | 'draft' | 'accepted';

export interface PresentationProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  title: string;
  status: PresentationStatus;
  baselineCapturedAt: string | null;
  showNeedsApproval: boolean;
  onExit: () => void;
}

const MINUS = '\u2212';

const baselineDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function statusLabel(status: PresentationStatus): string {
  switch (status) {
    case 'current':
      return 'CURRENT';
    case 'draft':
      return 'PROPOSED';
    case 'accepted':
      return 'ACCEPTED';
    default:
      return assertNever(status);
  }
}

function formatBaseline(iso: string): string {
  return `Baseline ${baselineDateFormat.format(new Date(iso))}`;
}

function memberTags(member: Member, ward: Ward): readonly { id: TagId; name: string }[] {
  const tags: { id: TagId; name: string }[] = [];
  for (const tagId of member.tagIds) {
    const tag = ward.tags[tagId];
    if (tag !== undefined) {
      tags.push({ id: tag.id, name: tag.name });
    }
  }
  return tags;
}

function LeaderSlot({
  leader,
  ward,
  showNeedsApproval,
}: {
  leader: OverviewLeader;
  ward: Ward;
  showNeedsApproval: boolean;
}): ReactElement {
  if (leader.memberId === null) {
    return (
      <div className="wb-presentation-leader">
        <span className="wb-presentation-avatar wb-presentation-avatar-vacant" aria-hidden="true" />
        <span className="wb-presentation-vacant-label">Vacant</span>
        <span className="wb-presentation-role">{leader.title}</span>
      </div>
    );
  }

  const member = ward.members[leader.memberId];
  const name = member !== undefined ? displayName(member.name) : 'Unknown';
  const avatarInitials = member !== undefined ? initials(member.name) : '?';
  const background = member !== undefined ? avatarColor(member.name) : '#2F5D8A';
  const avatarClass = leader.proposed
    ? 'wb-presentation-avatar wb-presentation-avatar-proposed'
    : 'wb-presentation-avatar';
  const tags = member !== undefined ? memberTags(member, ward) : [];
  const needsApproval = showNeedsApproval && member !== undefined && member.needsApproval;

  return (
    <div className="wb-presentation-leader">
      <Portrait
        url={member === undefined || member.photoRef === null ? null : photoUrl(member.photoRef)}
        className={`${avatarClass} wb-presentation-avatar-photo`}
      >
        <span className={avatarClass} style={{ backgroundColor: background }} aria-hidden="true">
          {avatarInitials}
        </span>
      </Portrait>
      <span className="wb-presentation-name">{name}</span>
      {leader.proposed ? <span className="wb-presentation-proposed">Proposed</span> : null}
      <span className="wb-presentation-role">{leader.title}</span>
      {tags.length > 0 ? (
        <ul className="wb-presentation-tags">
          {tags.map((tag) => (
            <li key={tag.id}>{tag.name}</li>
          ))}
        </ul>
      ) : null}
      {needsApproval ? <span className="wb-presentation-needs-approval">Needs approval</span> : null}
    </div>
  );
}

export function Presentation({
  board,
  ward,
  baseline,
  title,
  status,
  baselineCapturedAt,
  showNeedsApproval,
  onExit,
}: PresentationProps): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onExit]);

  const diff = baseline === null ? null : diffBoards(baseline, board);
  const vacant = vacancies(board).length;
  const tiles = wardOverview(board, baseline);
  const label = statusLabel(status);

  return (
    <div className="wb-presentation">
      <header className="wb-presentation-header">
        <div className="wb-presentation-heading">
          <span className={`wb-presentation-badge wb-presentation-badge-${status}`}>{label}</span>
          <h1 className="wb-presentation-title">{title}</h1>
        </div>
        <div className="wb-presentation-counts">
          {diff !== null ? (
            <>
              <span className="wb-presentation-count-callings">+{String(diff.callings.length)} callings</span>
              <span className="wb-presentation-count-releases">{`${MINUS}${String(diff.releases.length)} releases`}</span>
            </>
          ) : null}
          <span className="wb-presentation-count-vacant">{String(vacant)} vacant</span>
        </div>
      </header>

      <div className="wb-presentation-grid">
        {tiles.map((tile) => (
          <article key={tile.boardGroupId} className="wb-presentation-tile" aria-label={tile.name}>
            <div className="wb-presentation-tile-header">
              <h2 className="wb-presentation-tile-name">{tile.name}</h2>
              <span
                className={
                  tile.vacantCount > 0
                    ? 'wb-presentation-tile-vacant'
                    : 'wb-presentation-tile-vacant wb-presentation-tile-vacant-zero'
                }
              >
                {String(tile.vacantCount)} vacant
              </span>
            </div>
            {tile.leaders.length > 0 ? (
              <div className="wb-presentation-leaders">
                {tile.leaders.map((leader) => (
                  <LeaderSlot
                    key={leader.positionId}
                    leader={leader}
                    ward={ward}
                    showNeedsApproval={showNeedsApproval}
                  />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <footer className="wb-presentation-footer">
        {baselineCapturedAt !== null ? (
          <span className="wb-presentation-baseline">{formatBaseline(baselineCapturedAt)}</span>
        ) : (
          <span className="wb-presentation-baseline" />
        )}
        <span className="wb-presentation-legend">Ring = proposed change</span>
        <button type="button" className="wb-presentation-exit" onClick={onExit}>
          Exit presentation
        </button>
      </footer>
    </div>
  );
}

export default Presentation;
