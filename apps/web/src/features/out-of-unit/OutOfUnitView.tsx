import type { ReactElement, Ref } from 'react';
import {
  callingsOf,
  dugout,
  outOfUnitMembers,
  type Board,
  type MemberId,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { displayName } from '../../design/person.ts';
import './out-of-unit.css';

export interface OutOfUnitViewProps {
  board: Board;
  ward: Ward;
  readOnly: boolean;
  onAddToDugout: (memberId: MemberId) => void;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
}

export function OutOfUnitView({
  board,
  ward,
  readOnly,
  onAddToDugout,
  headingRef,
}: OutOfUnitViewProps): ReactElement {
  const entries = outOfUnitMembers(ward);
  const dugoutEntries = dugout(board, ward);
  const explicitSet = new Set(
    dugoutEntries.filter((d) => d.explicit).map((d) => d.memberId),
  );

  return (
    <section className="wb-out-of-unit-view" aria-labelledby="out-of-unit-heading">
      <div className="wb-out-of-unit-view-header">
        <h2
          ref={headingRef}
          id="out-of-unit-heading"
          tabIndex={-1}
          className="wb-out-of-unit-heading"
        >
          Out-of-Unit
        </h2>
        <p className="wb-out-of-unit-description">
          These members hold callings outside the ward and generally can't be called here. Placing one in a ward calling asks for confirmation.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="wb-out-of-unit-empty">No one in the ward holds a calling outside it.</p>
      ) : (
        <div className="wb-out-of-unit-list">
          {entries.map((entry) => {
            const member = ward.members[entry.memberId];
            const name = member !== undefined ? displayName(member.name) : 'Unknown';
            const categoryText = member?.category === 'youth' ? 'Youth' : 'Adult';
            const wardCallings = callingsOf(board, entry.memberId);
            const isExplicitInDugout = explicitSet.has(entry.memberId);

            return (
              <article
                key={entry.memberId}
                className="wb-out-of-unit-card"
                data-member-id={entry.memberId}
                aria-label={name}
              >
                <div className="wb-out-of-unit-card-main">
                  <div className="wb-out-of-unit-card-header">
                    <h3 className="wb-out-of-unit-card-name">{name}</h3>
                    <span className="wb-out-of-unit-card-category">{categoryText}</span>
                  </div>

                  <ul className="wb-out-of-unit-callings-list">
                    {entry.callings.map((calling, index) => (
                      <li key={index} className="wb-out-of-unit-calling-line">
                        {calling.title} · {calling.unit}
                      </li>
                    ))}
                  </ul>

                  {wardCallings.length > 0 ? (
                    <p className="wb-out-of-unit-ward-callings">
                      Also serves in the ward as {wardCallings.map((c) => c.title).join(', ')}
                    </p>
                  ) : null}
                </div>

                <div className="wb-out-of-unit-card-actions">
                  {isExplicitInDugout ? (
                    <span className="wb-out-of-unit-in-dugout">
                      In the dugout · placed here on purpose
                    </span>
                  ) : !readOnly ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onAddToDugout(entry.memberId);
                      }}
                    >
                      Add to dugout
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
