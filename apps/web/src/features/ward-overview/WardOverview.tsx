import type { ReactElement } from 'react';
import { wardOverview, type Board, type BoardGroupId, type OverviewLeader, type Ward } from '@wardboard/core';
import { Chip } from '../../design/Chip.tsx';
import { avatarColor, displayName, initials } from '../../design/person.ts';
import './ward-overview.css';

export interface WardOverviewProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  selectedId?: BoardGroupId | undefined;
}

function VacancyIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="10"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 1.5"
      />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LeaderSlot({ leader, ward }: { leader: OverviewLeader; ward: Ward }): ReactElement {
  if (leader.memberId === null) {
    return (
      <div className="wb-overview-leader">
        <div className="wb-overview-avatar-wrapper">
          <span className="wb-overview-avatar-vacant" aria-hidden="true">
            <PlusIcon />
          </span>
        </div>
        <span className="wb-overview-leader-vacant-text">Vacant</span>
        <span className="wb-overview-leader-title">{leader.title}</span>
      </div>
    );
  }

  const member = ward.members[leader.memberId];
  const name = member !== undefined ? displayName(member.name) : 'Unknown';
  const avatarInitials = member !== undefined ? initials(member.name) : '?';
  const bg = member !== undefined ? avatarColor(member.name) : '#2F5D8A';

  return (
    <div className="wb-overview-leader">
      <div className="wb-overview-avatar-wrapper">
        <span
          className={`wb-overview-avatar ${leader.proposed ? 'wb-overview-avatar-proposed' : ''}`}
          style={{ backgroundColor: bg }}
          aria-hidden="true"
        >
          {avatarInitials}
        </span>
      </div>
      <span className="wb-overview-leader-name">{name}</span>
      {leader.proposed ? <span className="wb-overview-leader-proposed-badge">+ Proposed</span> : null}
      <span className="wb-overview-leader-title">{leader.title}</span>
    </div>
  );
}

export function WardOverview({ board, ward, baseline, selectedId }: WardOverviewProps): ReactElement {
  const tiles = wardOverview(board, baseline);

  if (tiles.length === 0) {
    return (
      <div className="wb-overview">
        <p className="wb-overview-empty">No organizations are shown.</p>
      </div>
    );
  }

  return (
    <div className="wb-overview">
      <div className="wb-overview-grid">
        {tiles.map((tile) => {
          const isSelected = selectedId !== undefined && selectedId === tile.boardGroupId;
          return (
            <article
              key={tile.boardGroupId}
              className="wb-overview-tile"
              data-zoom-target={`org:${tile.boardGroupId}`}
              aria-label={tile.name}
              {...(isSelected ? { 'aria-current': 'true' as const } : {})}
            >
              <div className="wb-overview-tile-header">
                <h2 className="wb-overview-tile-name">{tile.name}</h2>
                <span
                  className={`wb-overview-vacancy ${
                    tile.vacantCount > 0 ? 'wb-overview-vacancy-active' : 'wb-overview-vacancy-zero'
                  }`}
                >
                  {tile.vacantCount > 0 ? (
                    <>
                      <VacancyIcon />
                      <span>{String(tile.vacantCount)} vacant</span>
                    </>
                  ) : (
                    <span>No vacancies</span>
                  )}
                </span>
              </div>

              {tile.leaders.length > 0 ? (
                <div className="wb-overview-leaders">
                  {tile.leaders.map((leader) => (
                    <LeaderSlot key={leader.positionId} leader={leader} ward={ward} />
                  ))}
                </div>
              ) : null}

              <div className="wb-overview-tile-footer">
                <span className="wb-overview-tile-counts">
                  {String(tile.positionCount)} positions · {String(tile.filledCount)} filled
                </span>
                {tile.changeCount > 0 ? (
                  <Chip variant="proposed" label={`${String(tile.changeCount)} proposed`} />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default WardOverview;
