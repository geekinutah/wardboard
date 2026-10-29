import { useState, type CSSProperties, type ReactElement } from 'react';
import { dugout, type Board, type DugoutEntry, type Member, type Ward } from '@wardboard/core';
import { PersonCard } from '../../design/PersonCard.tsx';
import { avatarColor, initials } from '../../design/person.ts';
import { photoUrl } from '../photos/upload.ts';
import './dugout.css';

const VISIBLE_LIMIT = 6;
const WEEKDAY_TAG = 'Weekday availability';

type CategoryFilter = 'all' | 'adults' | 'youth';

const CATEGORY_FILTERS: readonly { readonly id: CategoryFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'adults', label: 'Adults' },
  { id: 'youth', label: 'Youth' },
];

export interface DugoutPanelProps {
  readonly board: Board;
  readonly ward: Ward;
}

function categoryLabel(category: Member['category']): string {
  switch (category) {
    case 'adult':
      return 'Adult';
    case 'youth':
      return 'Youth';
  }
}

function tagNames(ward: Ward, member: Member): string[] {
  const names: string[] = [];
  for (const tagId of member.tagIds) {
    const tag = ward.tags[tagId];
    if (tag !== undefined) {
      names.push(tag.name);
    }
  }
  return names;
}

function hasWeekdayTag(ward: Ward, member: Member): boolean {
  for (const tagId of member.tagIds) {
    if (ward.tags[tagId]?.name === WEEKDAY_TAG) {
      return true;
    }
  }
  return false;
}

function matchesFilter(member: Member, ward: Ward, category: CategoryFilter, weekday: boolean): boolean {
  const categoryMatches =
    category === 'all' ||
    (category === 'adults' && member.category === 'adult') ||
    (category === 'youth' && member.category === 'youth');
  if (!categoryMatches) {
    return false;
  }
  if (!weekday) {
    return true;
  }
  return hasWeekdayTag(ward, member);
}

function placedLine(entry: DugoutEntry): string | null {
  if (!entry.explicit) {
    return null;
  }
  if (entry.callings.length === 0) {
    return 'Placed here';
  }
  return `Placed here · still serves as ${entry.callings.map((calling) => calling.title).join(', ')}`;
}

function memberOf(ward: Ward, entry: DugoutEntry): Member | undefined {
  return ward.members[entry.memberId];
}

function rowStyle(name: string): CSSProperties {
  return {
    '--wb-dugout-initials': `"${initials(name)}"`,
    '--wb-dugout-avatar': avatarColor(name),
  } as CSSProperties;
}

export function DugoutPanel({ board, ward }: DugoutPanelProps): ReactElement {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [weekday, setWeekday] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const entries = dugout(board, ward);
  const filtered = entries.filter((entry) => {
    const member = memberOf(ward, entry);
    return member !== undefined && matchesFilter(member, ward, category, weekday);
  });
  const visible = expanded ? filtered : filtered.slice(0, VISIBLE_LIMIT);
  const remaining = filtered.length - visible.length;
  const heading = `Dugout · ${String(filtered.length)}`;

  let status: string | null = null;
  if (entries.length === 0) {
    status = 'No one is in the dugout.';
  } else if (filtered.length === 0) {
    status = 'No one matches this filter.';
  }

  function chooseCategory(next: CategoryFilter): void {
    setCategory(next);
    setExpanded(false);
  }

  function toggleWeekday(): void {
    setWeekday((current) => !current);
    setExpanded(false);
  }

  return (
    <aside aria-label="Dugout" className="wb-dugout" data-drop-target="dugout">
      <h2 className="wb-dugout-heading" aria-label={heading}>
        <span className="wb-dugout-title">Dugout</span>
        <span className="wb-dugout-count">{` · ${String(filtered.length)}`}</span>
      </h2>
      <p className="wb-dugout-note">
        People with no calling in this proposal, plus anyone placed here on purpose. Not a measure of availability.
      </p>
      <div className="wb-dugout-filters">
        <div className="wb-dugout-category" role="group" aria-label="Category">
          {CATEGORY_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="wb-dugout-filter"
              aria-pressed={category === filter.id}
              onClick={() => {
                chooseCategory(filter.id);
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <button type="button" className="wb-dugout-filter" aria-pressed={weekday} onClick={toggleWeekday}>
          Weekday
        </button>
      </div>
      {status === null ? null : <p className="wb-dugout-empty">{status}</p>}
      <div className="wb-dugout-rows">
        {visible.map((entry) => {
          const member = memberOf(ward, entry);
          if (member === undefined) {
            return null;
          }
          const placed = placedLine(entry);
          const kind = categoryLabel(member.category);
          return (
            <article
              key={member.id}
              className="wb-dugout-row"
              data-member-id={member.id}
              style={rowStyle(member.name)}
            >
              <PersonCard
                name={`${member.name} · ${kind}`}
                tags={tagNames(ward, member)}
                needsApproval={member.needsApproval}
                photoUrl={member.photoRef === null ? null : photoUrl(member.photoRef)}
                {...(placed === null ? {} : { callingTitle: placed })}
              />
            </article>
          );
        })}
      </div>
      {remaining > 0 ? (
        <button
          type="button"
          className="wb-dugout-more"
          onClick={() => {
            setExpanded(true);
          }}
        >
          {`Show ${String(remaining)} more`}
        </button>
      ) : null}
    </aside>
  );
}
