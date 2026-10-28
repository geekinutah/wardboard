import { useState, type ReactElement } from 'react';
import { dugout, type Board, type Ward } from '@wardboard/core';
import { avatarColor, initials } from '../../design/person.ts';
import './phone-dugout.css';

export interface PhoneDugoutProps {
  readonly board: Board;
  readonly ward: Ward;
  readonly editable: boolean;
  readonly onPlaceMember: (memberId: string) => void;
}

type DugoutCategoryFilter = 'all' | 'adults' | 'youth';

const WEEKDAY_TAG_NAMES = new Set(['Weekday availability', 'Weekday']);
const TEACHING_TAG_NAMES = new Set(['Teaches well', 'Teaching']);

export function PhoneDugout({
  board,
  ward,
  editable,
  onPlaceMember,
}: PhoneDugoutProps): ReactElement {
  const [categoryFilter, setCategoryFilter] = useState<DugoutCategoryFilter>('all');
  const [weekdayFilter, setWeekdayFilter] = useState(false);
  const [teachingFilter, setTeachingFilter] = useState(false);

  const allEntries = dugout(board, ward);

  const filteredRows = allEntries.filter((entry) => {
    const member = ward.members[entry.memberId];
    if (member === undefined) return false;

    if (categoryFilter === 'adults' && member.category !== 'adult') {
      return false;
    }
    if (categoryFilter === 'youth' && member.category !== 'youth') {
      return false;
    }

    if (weekdayFilter) {
      const hasWeekday = member.tagIds.some((tagId) => {
        const tag = ward.tags[tagId];
        return tag !== undefined && WEEKDAY_TAG_NAMES.has(tag.name);
      });
      if (!hasWeekday) return false;
    }

    if (teachingFilter) {
      const hasTeaching = member.tagIds.some((tagId) => {
        const tag = ward.tags[tagId];
        return tag !== undefined && TEACHING_TAG_NAMES.has(tag.name);
      });
      if (!hasTeaching) return false;
    }

    return true;
  });

  return (
    <div className="wb-phone-dugout">
      <header className="wb-phone-dugout-header">
        <h1 className="wb-phone-dugout-title">
          Dugout <span className="wb-phone-dugout-count">· {filteredRows.length}</span>
        </h1>
        <span className="wb-phone-dugout-subtitle">
          No calling in this proposal, or placed here on purpose. Not a measure of availability.
        </span>
        <div className="wb-phone-dugout-filters" role="toolbar" aria-label="Dugout filters">
          <button
            type="button"
            aria-pressed={categoryFilter === 'all'}
            className={`wb-phone-filter-chip ${categoryFilter === 'all' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setCategoryFilter('all');
            }}
          >
            {categoryFilter === 'all' ? '✓ All' : 'All'}
          </button>
          <button
            type="button"
            aria-pressed={categoryFilter === 'adults'}
            className={`wb-phone-filter-chip ${categoryFilter === 'adults' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setCategoryFilter('adults');
            }}
          >
            {categoryFilter === 'adults' ? '✓ Adults' : 'Adults'}
          </button>
          <button
            type="button"
            aria-pressed={categoryFilter === 'youth'}
            className={`wb-phone-filter-chip ${categoryFilter === 'youth' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setCategoryFilter('youth');
            }}
          >
            {categoryFilter === 'youth' ? '✓ Youth' : 'Youth'}
          </button>
          <button
            type="button"
            aria-pressed={weekdayFilter}
            className={`wb-phone-filter-chip ${weekdayFilter ? 'wb-pressed' : ''}`}
            onClick={() => {
              setWeekdayFilter((prev) => !prev);
            }}
          >
            {weekdayFilter ? '✓ Weekday' : 'Weekday'}
          </button>
          <button
            type="button"
            aria-pressed={teachingFilter}
            className={`wb-phone-filter-chip ${teachingFilter ? 'wb-pressed' : ''}`}
            onClick={() => {
              setTeachingFilter((prev) => !prev);
            }}
          >
            {teachingFilter ? '✓ Teaching' : 'Teaching'}
          </button>
        </div>
      </header>

      <div className="wb-phone-dugout-list">
        {allEntries.length === 0 ? (
          <p className="wb-phone-dugout-empty">No one is in the dugout.</p>
        ) : filteredRows.length === 0 ? (
          <p className="wb-phone-dugout-empty">No one matches this filter.</p>
        ) : (
          filteredRows.map((entry) => {
            const member = ward.members[entry.memberId];
            const name = member?.name ?? entry.memberId;
            const kind = member?.category === 'youth' ? 'Youth' : 'Adult';

            const parts: string[] = [];
            if (entry.explicit && entry.callings.length > 0) {
              parts.push(
                `Placed here · still ${entry.callings.map((c) => c.title).join(', ')}`,
              );
            } else if (entry.explicit) {
              parts.push('Placed here');
            }

            for (const tagId of member?.tagIds ?? []) {
              const tag = ward.tags[tagId];
              if (tag !== undefined) {
                parts.push(tag.name);
              }
            }

            if (member?.needsApproval === true) {
              parts.push('Needs approval');
            }

            const subtitle = parts.length === 0 ? 'No calling' : parts.join(' · ');
            const initial = initials(name);
            const color = avatarColor(name);

            if (editable) {
              return (
                <button
                  key={entry.memberId}
                  type="button"
                  className="wb-phone-dugout-row"
                  aria-label={`Place ${name}`}
                  onClick={() => {
                    onPlaceMember(entry.memberId);
                  }}
                >
                  <span
                    className="wb-phone-dugout-avatar"
                    aria-hidden="true"
                    style={{ backgroundColor: color }}
                  >
                    {initial}
                  </span>
                  <span className="wb-phone-dugout-info">
                    <span className="wb-phone-dugout-name">
                      {name} <span className="wb-phone-dugout-kind">· {kind}</span>
                    </span>
                    <span className="wb-phone-dugout-sub">{subtitle}</span>
                  </span>
                  <span className="wb-phone-dugout-action" aria-hidden="true">
                    Place
                  </span>
                </button>
              );
            }

            return (
              <article key={entry.memberId} className="wb-phone-dugout-row">
                <span
                  className="wb-phone-dugout-avatar"
                  style={{ backgroundColor: color }}
                >
                  {initial}
                </span>
                <span className="wb-phone-dugout-info">
                  <span className="wb-phone-dugout-name">
                    {name} <span className="wb-phone-dugout-kind">· {kind}</span>
                  </span>
                  <span className="wb-phone-dugout-sub">{subtitle}</span>
                </span>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
