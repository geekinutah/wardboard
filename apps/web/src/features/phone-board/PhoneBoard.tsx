import { useId, useState, type ReactElement } from 'react';
import { wardOverview, type Board, type OverviewLeader, type Ward } from '@wardboard/core';
import { cx } from '../../design/cx.ts';
import { avatarColor, initials } from '../../design/person.ts';
import {
  callingGroupNameFromHeading,
  phoneOrganization,
  phoneOrgList,
  type PhoneOrganization,
  type PhoneOrgSection,
  type PhonePositionRow,
} from './model.ts';
import './phone-board.css';

export type PhoneBoardScreen =
  | { readonly kind: 'list' }
  | { readonly kind: 'organization'; readonly boardGroupId: string };

export interface PhoneBoardProps {
  readonly board: Board;
  readonly baseline: Board | null;
  readonly ward: Ward;
  readonly editable: boolean;
  readonly onAddPosition: (callingGroupId: string) => void;
  readonly onOpenPerson: (memberId: string, positionId: string) => void;
  readonly onOpenVacancy: (positionId: string) => void;
  readonly initialScreen?: PhoneBoardScreen;
}

export interface PhoneOrganizationScreenProps {
  readonly organization: PhoneOrganization;
  readonly editable: boolean;
  readonly onBack: () => void;
  readonly onAddPosition: (callingGroupId: string) => void;
  readonly onOpenPerson: (memberId: string, positionId: string) => void;
  readonly onOpenVacancy: (positionId: string) => void;
}

function ChevronRightIcon(): ReactElement {
  return (
    <svg className="wb-phone-org-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ChevronLeftIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }): ReactElement {
  return (
    <button type="button" className="wb-phone-org-back" onClick={onBack}>
      <ChevronLeftIcon />
      <span>Board</span>
    </button>
  );
}

function LeaderAvatars({
  leaders,
  ward,
}: {
  readonly leaders: readonly OverviewLeader[];
  readonly ward: Ward;
}): ReactElement | null {
  const shown = leaders.slice(0, 3);
  if (shown.length === 0) {
    return null;
  }
  return (
    <span className="wb-phone-org-row-avatars" aria-hidden="true">
      {shown.map((leader) => {
        if (leader.memberId === null) {
          return <span key={leader.positionId} className="wb-phone-org-row-avatar wb-phone-org-row-avatar-vacant" />;
        }
        const member = ward.members[leader.memberId];
        const name = member === undefined ? '' : member.name;
        return (
          <span
            key={leader.positionId}
            className="wb-phone-org-row-avatar"
            style={{ backgroundColor: avatarColor(name) }}
          >
            {initials(name)}
          </span>
        );
      })}
    </span>
  );
}

function OrganizationList({
  board,
  baseline,
  ward,
  onOpen,
}: {
  readonly board: Board;
  readonly baseline: Board | null;
  readonly ward: Ward;
  readonly onOpen: (boardGroupId: string) => void;
}): ReactElement {
  const rows = phoneOrgList(board, baseline);
  const leaders = new Map<string, readonly OverviewLeader[]>(
    wardOverview(board, baseline).map((tile) => [tile.boardGroupId, tile.leaders]),
  );
  return (
    <main className="wb-phone-board" aria-label="Organizations">
      {rows.length === 0 ? (
        <p className="wb-phone-board-empty">No organizations.</p>
      ) : (
        <ul className="wb-phone-board-list">
          {rows.map((row) => (
            <li key={row.boardGroupId}>
              <button
                type="button"
                className="wb-phone-org-row"
                aria-label={`${row.name}, ${row.changeLabel}, ${row.vacantLabel}`}
                onClick={() => {
                  onOpen(row.boardGroupId);
                }}
              >
                <LeaderAvatars leaders={leaders.get(row.boardGroupId) ?? []} ward={ward} />
                <span className="wb-phone-org-row-text">
                  <span className="wb-phone-org-row-name">{row.name}</span>
                  <span className="wb-phone-org-row-changes">{row.changeLabel}</span>
                </span>
                <span className="wb-phone-org-row-vacant">{row.vacantLabel}</span>
                <ChevronRightIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function RowAvatar({ name, vacant }: { readonly name: string; readonly vacant: boolean }): ReactElement {
  if (vacant) {
    return <span className="wb-phone-org-avatar wb-phone-org-avatar-vacant" aria-hidden="true" />;
  }
  return (
    <span className="wb-phone-org-avatar" style={{ backgroundColor: avatarColor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function PositionRow({
  row,
  editable,
  onOpenPerson,
  onOpenVacancy,
}: {
  readonly row: PhonePositionRow;
  readonly editable: boolean;
  readonly onOpenPerson: (memberId: string, positionId: string) => void;
  readonly onOpenVacancy: (positionId: string) => void;
}): ReactElement {
  const vacant = row.memberId === null;
  const copy = (
    <>
      <RowAvatar name={row.name} vacant={vacant} />
      <span className="wb-phone-org-copy">
        <span className={vacant ? 'wb-phone-org-vacancy-name' : 'wb-phone-org-person-name'}>{row.name}</span>
        <span className="wb-phone-org-person-title">{row.title}</span>
      </span>
      {row.proposed ? <span className="wb-phone-org-proposed">+ Proposed</span> : null}
    </>
  );

  if (vacant && !editable) {
    return <div className="wb-phone-org-vacancy wb-phone-org-vacancy-static">{copy}</div>;
  }

  if (vacant) {
    return (
      <button
        type="button"
        className="wb-phone-org-vacancy"
        aria-label={`Vacant, ${row.title}`}
        onClick={() => {
          onOpenVacancy(row.positionId);
        }}
      >
        {copy}
      </button>
    );
  }

  const memberId = row.memberId;
  return (
    <button
      type="button"
      className={cx('wb-phone-org-person', row.proposed ? 'wb-phone-org-person-proposed' : undefined)}
      aria-label={`${row.name}, ${row.title}`}
      onClick={() => {
        onOpenPerson(memberId, row.positionId);
      }}
    >
      {copy}
    </button>
  );
}

function OrgSection({
  section,
  editable,
  onAddPosition,
  onOpenPerson,
  onOpenVacancy,
}: {
  readonly section: PhoneOrgSection;
  readonly editable: boolean;
  readonly onAddPosition: (callingGroupId: string) => void;
  readonly onOpenPerson: (memberId: string, positionId: string) => void;
  readonly onOpenVacancy: (positionId: string) => void;
}): ReactElement {
  const headingId = useId();
  const groupName = callingGroupNameFromHeading(section.heading);
  return (
    <section className="wb-phone-org-section" aria-labelledby={headingId}>
      <div className="wb-phone-org-section-head">
        <h2 id={headingId}>{section.heading}</h2>
        {editable ? (
          <button
            type="button"
            className="wb-phone-org-add"
            aria-label={`Add a position to ${groupName}`}
            onClick={() => {
              onAddPosition(section.callingGroupId);
            }}
          >
            <PlusIcon />
          </button>
        ) : null}
      </div>
      <div className="wb-phone-org-rows">
        {section.rows.map((row) => (
          <PositionRow
            key={row.positionId}
            row={row}
            editable={editable}
            onOpenPerson={onOpenPerson}
            onOpenVacancy={onOpenVacancy}
          />
        ))}
      </div>
    </section>
  );
}

export function PhoneOrganizationScreen({
  organization,
  editable,
  onBack,
  onAddPosition,
  onOpenPerson,
  onOpenVacancy,
}: PhoneOrganizationScreenProps): ReactElement {
  return (
    <div className="wb-phone-org">
      <header className="wb-phone-org-header">
        <BackButton onBack={onBack} />
        <div className="wb-phone-org-title-row">
          <h1 className="wb-phone-org-title">{organization.name}</h1>
          <span className="wb-phone-org-vacant">{organization.vacantLabel}</span>
        </div>
        <p className="wb-phone-org-overseer">{organization.overseerText}</p>
      </header>
      <div className="wb-phone-org-body">
        {organization.sections.length === 0 ? (
          <p className="wb-phone-org-empty">No positions in this organization.</p>
        ) : (
          organization.sections.map((section) => (
            <OrgSection
              key={section.callingGroupId}
              section={section}
              editable={editable}
              onAddPosition={onAddPosition}
              onOpenPerson={onOpenPerson}
              onOpenVacancy={onOpenVacancy}
            />
          ))
        )}
        <p className="wb-phone-org-hint">
          {editable ? 'Tap a person for options \u00B7 tap a vacancy to fill it' : 'This board is read-only'}
        </p>
      </div>
    </div>
  );
}

export function PhoneBoard({
  board,
  baseline,
  ward,
  editable,
  onAddPosition,
  onOpenPerson,
  onOpenVacancy,
  initialScreen = { kind: 'list' },
}: PhoneBoardProps): ReactElement {
  const [screen, setScreen] = useState(initialScreen);

  if (screen.kind === 'list') {
    return (
      <OrganizationList
        board={board}
        baseline={baseline}
        ward={ward}
        onOpen={(boardGroupId) => {
          setScreen({ kind: 'organization', boardGroupId });
        }}
      />
    );
  }

  const organization = phoneOrganization(board, ward, baseline, screen.boardGroupId);
  if (organization === null) {
    return (
      <div className="wb-phone-org">
        <header className="wb-phone-org-header">
          <BackButton
            onBack={() => {
              setScreen({ kind: 'list' });
            }}
          />
        </header>
        <p className="wb-phone-org-missing">Organization not found</p>
      </div>
    );
  }

  return (
    <PhoneOrganizationScreen
      organization={organization}
      editable={editable}
      onBack={() => {
        setScreen({ kind: 'list' });
      }}
      onAddPosition={onAddPosition}
      onOpenPerson={onOpenPerson}
      onOpenVacancy={onOpenVacancy}
    />
  );
}
