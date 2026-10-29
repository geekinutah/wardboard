import { useId, useState, type ReactElement, type ReactNode, type SubmitEvent } from 'react';
import {
  groupDetail,
  type AddAssignmentRequest,
  type AddCallingGroupRequest,
  type AssignmentType,
  type Board,
  type CallingGroupId,
  type DetailAssignment,
  type DetailPosition,
  type DetailSection,
  type MemberId,
  type PositionId,
  type RemovedState,
  type TagId,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { PersonCard } from '../../design/PersonCard.tsx';
import { RemovedCard } from '../../design/RemovedCard.tsx';
import { VacancySlot } from '../../design/VacancySlot.tsx';
import { photoUrl } from '../photos/upload.ts';
import './group-view.css';

const MIN_LIST_POSITIONS = 1;
const MAX_LIST_POSITIONS = 50;
const DEFAULT_LIST_POSITIONS = 2;

const GROUP_KIND_OPTIONS = [
  { value: 'class', label: 'Class' },
  { value: 'committee', label: 'Committee' },
  { value: 'quorum', label: 'Quorum' },
  { value: 'other', label: 'Other' },
] as const;

type GroupKind = (typeof GROUP_KIND_OPTIONS)[number]['value'];

export interface GroupDetailProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  callingGroupId: CallingGroupId;
  readOnly: boolean;
  onAddPosition: (request: AddAssignmentRequest) => void;
  onAddGroup: (request: AddCallingGroupRequest) => void;
  /**
   * Derived removal state (SPEC §8). When given, affected member and position
   * cards render the `RemovedCard` treatment. Without it the view renders
   * exactly as before.
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

function clampCount(value: number): number {
  if (!Number.isInteger(value) || value < MIN_LIST_POSITIONS) {
    return MIN_LIST_POSITIONS;
  }
  if (value > MAX_LIST_POSITIONS) {
    return MAX_LIST_POSITIONS;
  }
  return value;
}

function parseKind(value: string): GroupKind {
  switch (value) {
    case 'class':
    case 'committee':
    case 'quorum':
    case 'other':
      return value;
    default:
      return 'class';
  }
}

function tagNames(ward: Ward, ids: readonly TagId[]): string {
  const names: string[] = [];
  for (const id of ids) {
    const tag = ward.tags[id];
    if (tag !== undefined) {
      names.push(tag.name);
    }
  }
  return names.join(', ');
}

function memberTagNames(ward: Ward, memberId: MemberId): string[] {
  const member = ward.members[memberId];
  if (member === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const id of member.tagIds) {
    const tag = ward.tags[id];
    if (tag !== undefined) {
      names.push(tag.name);
    }
  }
  return names;
}

function memberName(ward: Ward, memberId: MemberId): string {
  return ward.members[memberId]?.name ?? '';
}

function cardAttrs(position: DetailPosition): { 'data-position-id': string; 'data-member-id'?: string } {
  if (position.memberId === null) {
    return { 'data-position-id': position.positionId };
  }
  return { 'data-position-id': position.positionId, 'data-member-id': position.memberId };
}

function MatchMark(): ReactElement {
  return (
    <svg className="wb-group-match-mark" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function TagLine({ lead, names, match }: { lead: string; names: string; match?: boolean }): ReactElement {
  return (
    <p className={match === true ? 'wb-group-tagline wb-group-matches' : 'wb-group-tagline'}>
      {match === true ? <MatchMark /> : null}
      <span className="wb-group-prefer-chip">{`${lead} ${names}`}</span>
    </p>
  );
}

function portraitUrl(ward: Ward, id: MemberId): string | null {
  const ref = ward.members[id]?.photoRef ?? null;
  return ref === null ? null : photoUrl(ref);
}

function PositionCard({
  ward,
  assignment,
  position,
  removed,
}: {
  ward: Ward;
  assignment: DetailAssignment;
  position: DetailPosition;
  removed: RemovedState | undefined;
}): ReactElement {
  const matches = tagNames(ward, position.preferenceMatches);
  const titled = assignment.type === 'single';
  const positionRemoved = isRemovedPosition(removed, position.positionId);
  const memberRemoved =
    position.memberId === null ? false : isRemovedMemberPosition(removed, position.memberId, position.positionId);
  return (
    <div className="wb-group-card" {...cardAttrs(position)}>
      {position.memberId === null ? (
        positionRemoved ? (
          <RemovedCard name={assignment.title} kind="position" />
        ) : (
          <VacancySlot {...(titled ? { title: assignment.title } : {})} />
        )
      ) : positionRemoved ? (
        <RemovedCard name={memberName(ward, position.memberId)} kind="position" proposed={position.proposed} />
      ) : (
        <>
          <PersonCard
            name={memberName(ward, position.memberId)}
            tags={memberTagNames(ward, position.memberId)}
            proposed={position.proposed}
            removed={memberRemoved}
            photoUrl={portraitUrl(ward, position.memberId)}
            {...(titled ? { callingTitle: assignment.title } : {})}
          />
          {matches.length > 0 ? <TagLine lead="Matches preferred:" names={matches} match /> : null}
        </>
      )}
    </div>
  );
}

function AssignmentBlock({
  ward,
  assignment,
  removed,
}: {
  ward: Ward;
  assignment: DetailAssignment;
  removed: RemovedState | undefined;
}): ReactElement {
  const prefers = tagNames(ward, assignment.preferredMemberTagIds);
  const prefersLine = prefers.length > 0 ? <TagLine lead="Prefers" names={prefers} /> : null;

  if (assignment.type === 'list') {
    const people = assignment.positions.filter((position) => position.memberId !== null);
    const vacancies = assignment.positions.filter((position) => position.memberId === null);
    return (
      <div className="wb-group-list-block">
        <div className="wb-group-list-heading">
          <h3>{assignment.title}</h3>
          <p className="wb-group-list-count">
            {`List · ${String(assignment.filledCount)} of ${String(assignment.positions.length)} filled`}
          </p>
        </div>
        {prefersLine}
        <ul className="wb-group-people" aria-label={assignment.title}>
          {people.map((position) => (
            <li key={position.positionId}>
              <PositionCard ward={ward} assignment={assignment} position={position} removed={removed} />
            </li>
          ))}
          {vacancies.map((position) => (
            <li key={position.positionId}>
              <PositionCard ward={ward} assignment={assignment} position={position} removed={removed} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="wb-group-single">
      {prefersLine}
      {assignment.positions.map((position) => (
        <PositionCard key={position.positionId} ward={ward} assignment={assignment} position={position} removed={removed} />
      ))}
    </div>
  );
}

function helperText(count: number): string {
  return `Adds ${String(count)} vacant position(s) to this proposal only. Current and other proposals are unchanged.`;
}

function AddPositionForm({
  sectionName,
  groupId,
  onAddPosition,
  onClose,
}: {
  sectionName: string;
  groupId: CallingGroupId;
  onAddPosition: (request: AddAssignmentRequest) => void;
  onClose: () => void;
}): ReactElement {
  const formId = useId();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssignmentType>('single');
  const [count, setCount] = useState(DEFAULT_LIST_POSITIONS);
  const [error, setError] = useState('');
  const shownCount = type === 'single' ? 1 : count;

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Enter a calling title');
      return;
    }
    onAddPosition({
      groupId,
      title: trimmed,
      type,
      positionCount: type === 'single' ? 1 : count,
    });
    onClose();
  }

  return (
    <form className="wb-group-form" aria-label={`Add a position to ${sectionName}`} onSubmit={submit}>
      <label className="wb-group-field">
        Calling title
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError('');
          }}
        />
      </label>
      <fieldset className="wb-group-fieldset">
        <legend>Type</legend>
        <div className="wb-group-choices">
          <label className="wb-group-choice">
            <input
              type="radio"
              name={`${formId}-type`}
              value="single"
              checked={type === 'single'}
              onChange={() => {
                setType('single');
              }}
            />
            Single person
          </label>
          <label className="wb-group-choice">
            <input
              type="radio"
              name={`${formId}-type`}
              value="list"
              checked={type === 'list'}
              onChange={() => {
                setType('list');
              }}
            />
            List
          </label>
        </div>
      </fieldset>
      {type === 'list' ? (
        <div className="wb-group-stepper-field">
          <label htmlFor={`${formId}-count`}>Positions</label>
          <div className="wb-group-stepper">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCount((current) => clampCount(current - 1));
              }}
            >
              −
            </Button>
            <input
              id={`${formId}-count`}
              type="number"
              min={MIN_LIST_POSITIONS}
              max={MAX_LIST_POSITIONS}
              value={count}
              onChange={(event) => {
                setCount(clampCount(Number.parseInt(event.target.value, 10)));
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCount((current) => clampCount(current + 1));
              }}
            >
              +
            </Button>
          </div>
        </div>
      ) : null}
      <p className="wb-group-help">{helperText(shownCount)}</p>
      {error === '' ? null : (
        <p className="wb-group-error" role="alert">
          {error}
        </p>
      )}
      <div className="wb-group-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Add position</Button>
      </div>
    </form>
  );
}

function SectionBlock({
  section,
  ward,
  readOnly,
  onAddPosition,
  removed,
}: {
  section: DetailSection;
  ward: Ward;
  readOnly: boolean;
  onAddPosition: (request: AddAssignmentRequest) => void;
  removed: RemovedState | undefined;
}): ReactElement {
  const [formOpen, setFormOpen] = useState(false);
  const headingId = useId();

  return (
    <section className="wb-group-section" aria-labelledby={headingId} data-depth={section.depth}>
      <h2 id={headingId} className="wb-group-section-title">
        {section.name}
      </h2>
      {section.assignments.length === 0 ? <p className="wb-group-empty">No positions yet.</p> : null}
      {section.assignments.length > 0 ? (
        <div className="wb-group-assignments">
          {section.assignments.map((assignment) => (
            <AssignmentBlock key={assignment.assignmentId} ward={ward} assignment={assignment} removed={removed} />
          ))}
        </div>
      ) : null}
      {readOnly ? null : (
        <Button
          type="button"
          variant="secondary"
          className="wb-group-add"
          onClick={() => {
            setFormOpen(true);
          }}
        >
          {`Add position to ${section.name}`}
        </Button>
      )}
      {readOnly || !formOpen ? null : (
        <AddPositionForm
          sectionName={section.name}
          groupId={section.callingGroupId}
          onAddPosition={onAddPosition}
          onClose={() => {
            setFormOpen(false);
          }}
        />
      )}
    </section>
  );
}

function AddGroupForm({
  groupName,
  callingGroupId,
  onAddGroup,
  onClose,
}: {
  groupName: string;
  callingGroupId: CallingGroupId;
  onAddGroup: (request: AddCallingGroupRequest) => void;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupKind>('class');
  const [error, setError] = useState('');

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Enter a group name');
      return;
    }
    onAddGroup({
      parent: { kind: 'callingGroup', id: callingGroupId },
      name: trimmed,
      kind,
    });
    onClose();
  }

  return (
    <form className="wb-group-form" aria-label={`Add a group to ${groupName}`} onSubmit={submit}>
      <label className="wb-group-field">
        Group name
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
      </label>
      <label className="wb-group-field">
        Kind
        <select
          value={kind}
          onChange={(event) => {
            setKind(parseKind(event.target.value));
          }}
        >
          {GROUP_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error === '' ? null : (
        <p className="wb-group-error" role="alert">
          {error}
        </p>
      )}
      <div className="wb-group-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Add group</Button>
      </div>
    </form>
  );
}

export function GroupDetail({
  board,
  ward,
  baseline,
  callingGroupId,
  readOnly,
  onAddPosition,
  onAddGroup,
  removed,
}: GroupDetailProps): ReactElement {
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const titleId = useId();
  const detail = groupDetail(board, ward, callingGroupId, baseline);
  const organization = board.boardGroups[detail.boardGroupId];
  if (organization === undefined) {
    throw new TypeError(`board group ${detail.boardGroupId} does not exist`);
  }

  let disabledNote: ReactNode = null;
  if (detail.disabledAssignmentCount > 0) {
    disabledNote = (
      <p className="wb-group-disabled">
        {`${String(detail.disabledAssignmentCount)} optional roles off · not counted as vacancies`}
      </p>
    );
  }

  return (
    <div className="wb-group-detail">
      <header className="wb-group-header">
        <h1 id={titleId} className="wb-group-title">
          {`${organization.name} · ${detail.name}`}
        </h1>
      </header>
      {detail.sections.map((section) => (
        <SectionBlock
          key={section.callingGroupId}
          section={section}
          ward={ward}
          readOnly={readOnly}
          onAddPosition={onAddPosition}
          removed={removed}
        />
      ))}
      {disabledNote}
      {readOnly ? null : (
        <Button
          type="button"
          variant="secondary"
          className="wb-group-add"
          onClick={() => {
            setGroupFormOpen(true);
          }}
        >
          {`Add group to ${detail.name}`}
        </Button>
      )}
      {readOnly || !groupFormOpen ? null : (
        <AddGroupForm
          groupName={detail.name}
          callingGroupId={detail.callingGroupId}
          onAddGroup={onAddGroup}
          onClose={() => {
            setGroupFormOpen(false);
          }}
        />
      )}
    </div>
  );
}
