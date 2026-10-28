import type { ReactElement } from 'react';
import { outOfUnitMembers, type Ward } from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { displayName } from '../../design/person.ts';
import './out-of-unit.css';

export interface OutOfUnitTileProps {
  ward: Ward;
  onOpen: () => void;
}

export function OutOfUnitTile({ ward, onOpen }: OutOfUnitTileProps): ReactElement {
  const entries = outOfUnitMembers(ward);
  const count = entries.length;

  let summaryText = 'No members serving outside the ward';
  if (count === 1) {
    summaryText = '1 member serving outside the ward';
  } else if (count > 1) {
    summaryText = `${String(count)} members serving outside the ward`;
  }

  const visibleEntries = entries.slice(0, 3);
  const remainingCount = count - 3;

  return (
    <article
      className="wb-out-of-unit-tile"
      aria-label="Out-of-Unit"
      onDoubleClick={onOpen}
    >
      <div className="wb-out-of-unit-tile-header">
        <div className="wb-out-of-unit-tile-titles">
          <span className="wb-out-of-unit-tile-label">Outside the ward</span>
          <h3 className="wb-out-of-unit-tile-heading">Out-of-Unit</h3>
        </div>
      </div>

      <p className="wb-out-of-unit-tile-summary">{summaryText}</p>

      {count > 0 ? (
        <ul className="wb-out-of-unit-tile-members">
          {visibleEntries.map((entry) => {
            const member = ward.members[entry.memberId];
            const name = member !== undefined ? displayName(member.name) : 'Unknown';
            return (
              <li key={entry.memberId} className="wb-out-of-unit-tile-member-name">
                {name}
              </li>
            );
          })}
          {remainingCount > 0 ? (
            <li className="wb-out-of-unit-tile-more">+{String(remainingCount)} more</li>
          ) : null}
        </ul>
      ) : null}

      <div className="wb-out-of-unit-tile-footer">
        <Button variant="secondary" onClick={onOpen} className="wb-out-of-unit-open-btn">
          Open Out-of-Unit
        </Button>
      </div>
    </article>
  );
}
