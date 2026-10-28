import { useId, type ReactElement } from 'react';
import type { RemovedRows } from './rows.ts';
import './removed.css';

const minus = '\u2212';

export type RemovedSummaryProps = {
  rows: RemovedRows;
};

/**
 * Diff-style summary of what Current lost since this proposal's baseline
 * (SPEC §8, artboard 9): the affected members and positions. There is no
 * Accept button here: acceptance UI is T-041/T-051.
 */
export function RemovedSummary({ rows }: RemovedSummaryProps): ReactElement | null {
  const headingId = useId();
  if (rows.total === 0) {
    return null;
  }
  const memberCount = rows.members.length;
  const positionCount = rows.positions.length;
  return (
    <section className="wb-removed-summary" aria-labelledby={headingId}>
      <h2 id={headingId} className="wb-removed-summary-heading">
        {`Removed from Current since this baseline · ${String(rows.total)}`}
      </h2>
      {memberCount > 0 ? (
        <div className="wb-removed-summary-block">
          <h3 className="wb-removed-summary-block-title">
            <span className="wb-removed-summary-minus" aria-hidden="true">
              {minus}
            </span>
            <span className="wb-removed-summary-block-name">Ward member removed</span>
            <span className="wb-removed-summary-count">
              {`${String(memberCount)} ${memberCount === 1 ? 'person' : 'people'}`}
            </span>
          </h3>
          <ul className="wb-removed-summary-lines">
            {rows.members.flatMap((member) =>
              member.positions.map((position) => (
                <li key={`${member.memberId}-${position.positionId}`} className="wb-removed-summary-line">
                  <span className="wb-removed-summary-mark">{`${minus} ${member.name}`}</span>
                  <span className="wb-removed-summary-note">{`proposed here as ${position.title}`}</span>
                </li>
              )),
            )}
          </ul>
        </div>
      ) : null}
      {positionCount > 0 ? (
        <div className="wb-removed-summary-block">
          <h3 className="wb-removed-summary-block-title">
            <span className="wb-removed-summary-minus" aria-hidden="true">
              {minus}
            </span>
            <span className="wb-removed-summary-block-name">Position removed</span>
            <span className="wb-removed-summary-count">
              {`${String(positionCount)} ${positionCount === 1 ? 'position' : 'positions'}`}
            </span>
          </h3>
          <ul className="wb-removed-summary-lines">
            {rows.positions.map((position) => (
              <li key={position.positionId} className="wb-removed-summary-line">
                <span className="wb-removed-summary-mark">
                  {`${minus} ${position.groupName} · ${position.title}`}
                </span>
                {position.occupantName !== null ? (
                  <span className="wb-removed-summary-note">{`held here by ${position.occupantName}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
