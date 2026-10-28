import type { ReactElement } from 'react';
import {
  callingsOf,
  dugout,
  rootBoardGroupOf,
  type Board,
  type HeldCalling,
  type Member,
  type MemberId,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { Chip } from '../../design/Chip.tsx';
import { avatarColor, initials } from '../../design/person.ts';
import './person.css';

export interface PersonInspectorProps {
  readonly board: Board;
  readonly ward: Ward;
  readonly memberId: MemberId;
  readonly readOnly: boolean;
  readonly onOpenNotes: (memberId: MemberId) => void;
  readonly onAddToDugout: (memberId: MemberId) => void;
}

function categoryLabel(category: Member['category']): string {
  switch (category) {
    case 'adult':
      return 'Adult';
    case 'youth':
      return 'Youth';
  }
}

function placeLine(board: Board, calling: HeldCalling): string {
  const group = board.callingGroups[calling.callingGroupId];
  const root = board.boardGroups[rootBoardGroupOf(board, calling.callingGroupId)];
  if (group === undefined || root === undefined) {
    throw new Error('calling is missing its group');
  }
  return `${group.name} · ${root.name}`;
}

function tagNames(ward: Ward, member: Member): string[] {
  const names: string[] = [];
  for (const id of member.tagIds) {
    const tag = ward.tags[id];
    if (tag !== undefined) {
      names.push(tag.name);
    }
  }
  return names;
}

export function PersonInspector({
  board,
  ward,
  memberId,
  readOnly,
  onOpenNotes,
  onAddToDugout,
}: PersonInspectorProps): ReactElement {
  const member = Object.hasOwn(ward.members, memberId) ? ward.members[memberId] : undefined;
  if (member === undefined) {
    return (
      <aside aria-label="Person" className="wb-person-inspector" data-member-id={memberId}>
        <p className="wb-person-missing">This person is not in the ward.</p>
      </aside>
    );
  }

  const proposal = board.kind === 'proposal';
  const callingsHeading = proposal ? 'Callings in this proposal' : 'Callings in Current';
  const noCalling = proposal ? 'No calling in this proposal' : 'No calling in Current';
  const callings = callingsOf(board, member.id);
  const dugoutEntry = dugout(board, ward).find((entry) => entry.memberId === member.id);
  const dugoutText =
    dugoutEntry === undefined
      ? null
      : dugoutEntry.explicit
        ? 'In the dugout · placed here on purpose'
        : 'In the dugout';
  const offerDugout = !readOnly && member.removedDate === null && (dugoutEntry === undefined || !dugoutEntry.explicit);
  const tags = tagNames(ward, member);

  return (
    <aside aria-label={`Person: ${member.name}`} className="wb-person-inspector" data-member-id={member.id}>
      <div className="wb-person-identity">
        <span className="wb-person-avatar" style={{ backgroundColor: avatarColor(member.name) }} aria-hidden="true">
          {initials(member.name)}
        </span>
        <div className="wb-person-identity-text">
          <h2 className="wb-person-name">{member.name}</h2>
          <p className="wb-person-category">{categoryLabel(member.category)}</p>
        </div>
      </div>
      {member.removedDate === null ? null : (
        <p className="wb-person-removed">{`Removed from Current on ${member.removedDate}`}</p>
      )}
      <section className="wb-person-section">
        <h3 className="wb-person-label">{callingsHeading}</h3>
        {callings.length >= 2 ? <p className="wb-person-serves">{`Serves in ${String(callings.length)} callings`}</p> : null}
        {callings.length === 0 ? <p className="wb-person-empty">{noCalling}</p> : null}
        {dugoutText === null ? null : <p className="wb-person-dugout">{dugoutText}</p>}
        {callings.length === 0 ? null : (
          <ul className="wb-person-callings" aria-label={callingsHeading}>
            {callings.map((calling) => (
              <li key={calling.positionId} className="wb-person-calling">
                <span className="wb-person-calling-title">{calling.title}</span>
                <span className="wb-person-calling-place">{placeLine(board, calling)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {tags.length === 0 ? null : (
        <section className="wb-person-section">
          <h3 className="wb-person-label">Tags</h3>
          <ul className="wb-person-tags" aria-label="Tags">
            {tags.map((name, index) => (
              <li key={`${name}-${String(index)}`}>
                <Chip variant="tag" label={name} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {member.needsApproval ? (
        <p className="wb-person-approval">
          <Chip variant="needs-approval" label="Needs approval" />
        </p>
      ) : null}
      {member.externalCallings.length === 0 ? null : (
        <section className="wb-person-section">
          <h3 className="wb-person-label">Outside the ward</h3>
          <ul className="wb-person-outside">
            {member.externalCallings.map((calling, index) => (
              <li key={`${calling.title}-${calling.unit}-${String(index)}`} className="wb-person-outside-line">
                {`${calling.title} · ${calling.unit}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="wb-person-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onOpenNotes(member.id);
          }}
        >
          Open notes
        </Button>
        {offerDugout ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onAddToDugout(member.id);
            }}
          >
            Add to dugout
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
