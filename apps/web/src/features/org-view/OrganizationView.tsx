import type { ReactElement } from 'react';
import {
  organizationView,
  type Board,
  type BoardGroupId,
  type Overseer,
  type Ward,
} from '@wardboard/core';
import { cx } from '../../design/cx.ts';
import { PersonCard } from '../../design/PersonCard.tsx';
import { VacancySlot } from '../../design/VacancySlot.tsx';
import './org-view.css';

export interface OrganizationViewProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  boardGroupId: BoardGroupId;
  selectedId?: string | undefined;
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
              return (
                <div
                  key={card.positionId}
                  className="wb-org-card-wrapper"
                  data-position-id={card.positionId}
                  {...(isOccupied ? { 'data-member-id': card.memberId } : {})}
                >
                  {isOccupied ? (
                    <PersonCard
                      name={memberName}
                      callingTitle={card.title}
                      proposed={card.proposed}
                    />
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
