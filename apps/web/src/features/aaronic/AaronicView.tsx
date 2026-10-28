import { useId, useState, type ReactElement } from 'react';
import {
  groupDetail,
  overseerOf,
  type Board,
  type BoardGroupId,
  type CallingGroup,
  type CallingGroupId,
  type DetailAssignment,
  type DetailPosition,
  type MemberId,
  type Overseer,
  type SetOversightRequest,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { cx } from '../../design/cx.ts';
import { PersonCard } from '../../design/PersonCard.tsx';
import { avatarColor, initials } from '../../design/person.ts';
import { VacancySlot } from '../../design/VacancySlot.tsx';
import { overseerLabel } from '../org-view/OrganizationView.tsx';
import './aaronic.css';

const OVERSEER_OPTIONS: readonly Overseer[] = ['bishop', 'first_counselor', 'second_counselor'];

export interface AaronicViewProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  boardGroupId: BoardGroupId;
  readOnly: boolean;
  onSetOversight: (request: SetOversightRequest) => void;
  onOpenBishopric?: (() => void) | undefined;
}

function compareOrderThenId<T extends { readonly order: number; readonly id: string }>(left: T, right: T): number {
  if (left.order !== right.order) return left.order - right.order;
  return left.id.localeCompare(right.id, 'en');
}

function topLevelGroups(board: Board, boardGroupId: BoardGroupId): CallingGroup[] {
  return Object.values(board.callingGroups)
    .filter((group) => group.parent.kind === 'boardGroup' && group.parent.id === boardGroupId)
    .sort(compareOrderThenId);
}

function isFixedGroup(board: Board, groupId: CallingGroupId): boolean {
  return board.oversight.some(
    (entry) => entry.fixed && entry.target.kind === 'callingGroup' && entry.target.id === groupId,
  );
}

function bishopHolder(board: Board, ward: Ward): string | null {
  const bishopric = Object.values(board.callingGroups).find((group) => group.kind === 'bishopric');
  if (bishopric === undefined) return null;
  const assignment = Object.values(board.assignments).find(
    (item) => item.groupId === bishopric.id && item.enabled && item.title === 'Bishop',
  );
  if (assignment === undefined) return null;
  const position = Object.values(board.positions)
    .filter((item) => item.assignmentId === assignment.id)
    .sort(compareOrderThenId)[0];
  if (position === undefined) return null;
  const memberId = board.placements[position.id];
  if (memberId === undefined) return null;
  const member = ward.members[memberId];
  if (member === undefined) return null;
  return member.name;
}

function memberName(ward: Ward, memberId: MemberId): string {
  return ward.members[memberId]?.name ?? '';
}

function countsOf(assignments: readonly DetailAssignment[]): { filled: number; vacant: number } {
  let filled = 0;
  let vacant = 0;
  for (const assignment of assignments) {
    filled += assignment.filledCount;
    vacant += assignment.positions.length - assignment.filledCount;
  }
  return { filled, vacant };
}

function LockIcon(): ReactElement {
  return (
    <svg className="wb-aaronic-lock" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

function LinkIcon(): ReactElement {
  return (
    <svg className="wb-aaronic-link" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function PositionCard({
  ward,
  assignment,
  position,
}: {
  ward: Ward;
  assignment: DetailAssignment;
  position: DetailPosition;
}): ReactElement {
  const titled = assignment.type === 'single';
  const memberId = position.memberId;
  return (
    <div
      className="wb-aaronic-card"
      data-position-id={position.positionId}
      {...(memberId === null ? {} : { 'data-member-id': memberId })}
    >
      {memberId === null ? (
        <VacancySlot {...(titled ? { title: assignment.title } : {})} />
      ) : (
        <PersonCard
          name={memberName(ward, memberId)}
          proposed={position.proposed}
          {...(titled ? { callingTitle: assignment.title } : {})}
        />
      )}
    </div>
  );
}

function LinkedBishop({ name, onOpen }: { name: string | null; onOpen: (() => void) | undefined }): ReactElement {
  return (
    <button
      type="button"
      className={cx('wb-aaronic-linked', name === null ? 'wb-aaronic-linked-vacant' : undefined)}
      onClick={() => {
        onOpen?.();
      }}
    >
      {name === null ? null : (
        <span className="wb-avatar" style={{ backgroundColor: avatarColor(name) }} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <span className="wb-aaronic-linked-copy">
        <span className="wb-aaronic-linked-name">{name === null ? 'Vacant' : name}</span>
        <span className="wb-aaronic-linked-note">Presides by office · linked from Bishopric</span>
      </span>
      <LinkIcon />
    </button>
  );
}

function QuorumColumn({
  board,
  ward,
  baseline,
  group,
  readOnly,
  bishopName,
  onSetOversight,
  onOpenBishopric,
}: {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  group: CallingGroup;
  readOnly: boolean;
  bishopName: string | null;
  onSetOversight: (request: SetOversightRequest) => void;
  onOpenBishopric: (() => void) | undefined;
}): ReactElement {
  const headingId = useId();
  const overseer = overseerOf(board, { kind: 'callingGroup', id: group.id });
  const fixed = isFixedGroup(board, group.id);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Overseer>(overseer);
  const detail = groupDetail(board, ward, group.id, baseline);
  const assignments = detail.sections.find((section) => section.depth === 0)?.assignments ?? [];
  const counts = countsOf(assignments);
  const showChange = !readOnly && !fixed && !open;
  const showEditor = open && !readOnly && !fixed;

  function openEditor(): void {
    setDraft(overseer);
    setOpen(true);
  }

  function confirm(): void {
    if (draft !== overseer) {
      onSetOversight({ target: { kind: 'callingGroup', id: group.id }, overseer: draft });
    }
    setOpen(false);
  }

  return (
    <section aria-labelledby={headingId} className="wb-aaronic-quorum">
      <div className="wb-aaronic-quorum-head">
        <h2 id={headingId} className="wb-aaronic-title">
          {group.name}
        </h2>
        <p className="wb-aaronic-overseer">
          <span className="wb-aaronic-overseer-sentence">
            {'Overseen by '}
            <span className="wb-aaronic-chip">
              {fixed ? <LockIcon /> : null}
              {overseerLabel(overseer)}
            </span>
            {fixed ? ' · fixed by office' : null}
          </span>
          {showChange ? (
            <Button type="button" variant="secondary" onClick={openEditor}>
              Change
            </Button>
          ) : null}
        </p>
        <p className="wb-aaronic-counts">
          {`${String(counts.filled)} filled · ${String(counts.vacant)} vacant`}
        </p>
      </div>
      {fixed ? <LinkedBishop name={bishopName} onOpen={onOpenBishopric} /> : null}
      {showEditor ? (
        <fieldset className="wb-aaronic-fieldset">
          <legend className="wb-aaronic-legend">Overseer</legend>
          <div className="wb-aaronic-choices">
            {OVERSEER_OPTIONS.map((option) => (
              <label key={option} className="wb-aaronic-choice">
                <input
                  type="radio"
                  name={`overseer-${group.id}`}
                  value={option}
                  checked={draft === option}
                  onChange={() => {
                    setDraft(option);
                  }}
                />
                {overseerLabel(option)}
              </label>
            ))}
          </div>
          <div className="wb-aaronic-actions">
            <Button type="button" onClick={confirm}>
              Confirm
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : null}
      <div className="wb-aaronic-positions">
        {assignments.map((assignment) =>
          assignment.positions.map((position) => (
            <PositionCard key={position.positionId} ward={ward} assignment={assignment} position={position} />
          )),
        )}
      </div>
    </section>
  );
}

export function AaronicView({
  board,
  ward,
  baseline,
  boardGroupId,
  readOnly,
  onSetOversight,
  onOpenBishopric,
}: AaronicViewProps): ReactElement {
  if (!Object.hasOwn(board.boardGroups, boardGroupId)) {
    throw new TypeError(`board group ${boardGroupId} does not exist`);
  }
  const groups = topLevelGroups(board, boardGroupId);
  const bishopName = bishopHolder(board, ward);

  return (
    <div className="wb-aaronic">
      <div className="wb-aaronic-grid">
        {groups.map((group) => (
          <QuorumColumn
            key={group.id}
            board={board}
            ward={ward}
            baseline={baseline}
            group={group}
            readOnly={readOnly}
            bishopName={bishopName}
            onSetOversight={onSetOversight}
            onOpenBishopric={onOpenBishopric}
          />
        ))}
      </div>
    </div>
  );
}
