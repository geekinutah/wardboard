import type { ReactElement } from 'react';
import {
  organizationView,
  type Board,
  type BoardGroupId,
  type MemberId,
  type Overseer,
  type PositionId,
  type RemovedState,
  type Ward,
} from '@wardboard/core';
import { cx } from '../../design/cx.ts';
import { PersonCard } from '../../design/PersonCard.tsx';
import { RemovedCard } from '../../design/RemovedCard.tsx';
import { VacancySlot } from '../../design/VacancySlot.tsx';
import './org-view.css';

export interface OrganizationViewProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  boardGroupId: BoardGroupId;
  selectedId?: string | undefined;
  /**
   * Derived removal state (SPEC §8). When given, affected leadership cards
   * render the `RemovedCard` treatment. Without it the view renders exactly
   * as before.
   */
  removed?: RemovedState | undefined;
}

/** True when `removed` lists `memberId` as removed and names this position. */
function isRemovedMemberPosition(removed: RemovedState | undefined, memberId: MemberId, positionId: PositionId): boolean {
  if (removed === undefined) {
    return false;
  }
  return removed.members.some((entry) => entry.memberId === memberId && entry.positionIds.includes(positionId));
}

/** True when `removed` lists this position's lineage as lost from Current. */
function isRemovedPosition(removed: RemovedState | undefined, positionId: PositionId): boolean {
  return removed !== undefined && removed.positions.includes(positionId);
}

export function overseerLabel(overseer: Overseer): string {
  switch (overseer) {
    case 'bishop':
      return 'Bishop';
    case 'first_counselor':
      return 'First Counselor';
    case 'second_counselor':
      return 'Second Counselor';
  }
}

export function OrganizationView({
  board,
  ward,
  baseline,
  boardGroupId,
  selectedId,
  removed,
}: OrganizationViewProps): ReactElement {
  const view = organizationView(board, boardGroupId, baseline);

  const leadershipVacancies = view.leadership.filter((c) => c.memberId === null).length;
  const groupVacancies = view.groups.reduce((acc, g) => acc + g.vacantCount, 0);
  const totalVacant = leadershipVacancies + groupVacancies;

  return (
    <div className="wb-org-view">
      <header className="wb-org-context">
        <div className="wb-org-context-main">
          <nav aria-label="Breadcrumb" className="wb-org-breadcrumb">
            Ward / {view.name}
          </nav>
          <span className="wb-org-name">{view.name}</span>
          <span className="wb-org-overseer">Overseen by {overseerLabel(view.overseer)}</span>
        </div>
        <span className="wb-org-vacancy-badge">{totalVacant} vacant</span>
      </header>

      <section aria-labelledby="wb-org-leadership-heading" className="wb-org-section">
        <div className="wb-org-section-header">
          <h2 id="wb-org-leadership-heading" className="wb-org-section-title">Leadership</h2>
        </div>
        {view.leadership.length === 0 ? (
          <p className="wb-org-empty">No leadership positions.</p>
        ) : (
          <div className="wb-org-leadership-grid">
            {view.leadership.map((card) => {
              const isOccupied = card.memberId !== null;
              const member = isOccupied ? ward.members[card.memberId] : undefined;
              const memberName = member ? member.name : '';
              const positionRemoved = isRemovedPosition(removed, card.positionId);
              const memberRemoved = isOccupied
                ? isRemovedMemberPosition(removed, card.memberId, card.positionId)
                : false;
              return (
                <div
                  key={card.positionId}
                  className="wb-org-card-wrapper"
                  data-position-id={card.positionId}
                  {...(isOccupied ? { 'data-member-id': card.memberId } : {})}
                >
                  {isOccupied ? (
                    positionRemoved ? (
                      <RemovedCard name={memberName} kind="position" proposed={card.proposed} />
                    ) : (
                      <PersonCard
                        name={memberName}
                        callingTitle={card.title}
                        proposed={card.proposed}
                        removed={memberRemoved}
                      />
                    )
                  ) : positionRemoved ? (
                    <RemovedCard name={card.title} kind="position" />
                  ) : (
                    <VacancySlot title={card.title} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="wb-org-groups-heading" className="wb-org-section">
        <div className="wb-org-section-header">
          <h2 id="wb-org-groups-heading" className="wb-org-section-title">Groups</h2>
        </div>
        {view.groups.length === 0 ? (
          <p className="wb-org-empty">No groups.</p>
        ) : (
          <div className="wb-org-groups-list">
            {view.groups.map((row) => {
              const group = board.callingGroups[row.callingGroupId];
              const isSupportRole = group?.key === 'bishopric_support';
              const showsOverseer = row.overseer !== view.overseer;
              const isSelected =
                selectedId === row.callingGroupId || selectedId === `group:${row.callingGroupId}`;

              return (
                <div
                  key={row.callingGroupId}
                  className={cx(
                    'wb-org-group-row',
                    isSelected ? 'wb-org-group-row-selected' : undefined,
                  )}
                  data-zoom-target={`group:${row.callingGroupId}`}
                  aria-label={row.name}
                  {...(isSelected ? { 'aria-current': 'true' as const } : {})}
                >
                  <div className="wb-org-group-info">
                    <span className="wb-org-group-name">{row.name}</span>
                    {isSupportRole ? (
                      <span className="wb-org-support-badge">Support roles</span>
                    ) : null}
                    {showsOverseer ? (
                      <span className="wb-org-group-overseer">
                        Overseen by {overseerLabel(row.overseer)}
                      </span>
                    ) : null}
                  </div>
                  <span className="wb-org-group-counts">
                    <span className="wb-org-group-filled">{row.filledCount} filled</span>
                    {row.vacantCount > 0 ? (
                      <>
                        {' · '}
                        <span className="wb-org-group-vacant">{row.vacantCount} vacant</span>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
