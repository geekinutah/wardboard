import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import {
  filterMatches,
  search,
  type AddToDugoutRequest,
  type AssignmentId,
  type Board,
  type BoardId,
  type CallingGroupId,
  type CallingResult,
  type GroupResult,
  type MemberCategory,
  type MemberId,
  type PersonResult,
  type PositionId,
  type SearchFilters,
  type TagId,
  type TagSearchResult,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { cx } from '../../design/cx.ts';
import { avatarColor, initials } from '../../design/person.ts';
import './search.css';

export type SearchTarget =
  | { readonly kind: 'person'; readonly memberId: MemberId }
  | {
      readonly kind: 'calling';
      readonly boardId: BoardId;
      readonly callingGroupId: CallingGroupId;
      readonly assignmentId: AssignmentId;
    }
  | { readonly kind: 'tag'; readonly tagId: TagId }
  | {
      readonly kind: 'group';
      readonly boardId: BoardId;
      readonly groupKind: 'boardGroup' | 'callingGroup';
      readonly id: string;
    };

export type SearchHighlight = {
  readonly memberIds: readonly MemberId[];
  readonly positionIds: readonly PositionId[];
};

export type SearchBoxProps = {
  ward: Ward;
  active: Board;
  boards: readonly Board[];
  readOnly: boolean;
  onNavigate: (target: SearchTarget) => void;
  onAddToDugout: (request: AddToDugoutRequest) => void;
  onHighlight: (highlight: SearchHighlight) => void;
  onClose: () => void;
};

type FilterState = {
  readonly vacant: boolean;
  readonly noCalling: boolean;
  readonly category: MemberCategory | null;
  readonly tagIds: readonly TagId[];
};

type ResultRow =
  | { readonly kind: 'person'; readonly person: PersonResult }
  | { readonly kind: 'calling'; readonly calling: CallingResult }
  | { readonly kind: 'tag'; readonly tag: TagSearchResult }
  | { readonly kind: 'group'; readonly group: GroupResult };

type IndexedRow = { readonly row: ResultRow; readonly index: number };

type SectionBlock = { readonly title: string; readonly rows: readonly IndexedRow[] };

const INITIAL_FILTERS: FilterState = {
  vacant: false,
  noCalling: false,
  category: null,
  tagIds: [],
};

/** Same empty-query rule as core search. The normalizer is not exported from the package. */
function normalizedQuery(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function filtersActive(filters: FilterState): boolean {
  return filters.vacant || filters.noCalling || filters.category !== null || filters.tagIds.length > 0;
}

function toSearchFilters(filters: FilterState): SearchFilters {
  const base: SearchFilters = {
    vacant: filters.vacant,
    noCalling: filters.noCalling,
    tagIds: filters.tagIds,
  };
  if (filters.category === null) {
    return base;
  }
  return { ...base, category: filters.category };
}

function singleScopeLabel(kind: Board['kind']): string {
  switch (kind) {
    case 'proposal':
      return 'This proposal';
    case 'current':
      return 'Current';
    case 'baseline':
      return 'Baseline';
    default: {
      const never: never = kind;
      return never;
    }
  }
}

function categoryLabel(category: MemberCategory): string {
  switch (category) {
    case 'adult':
      return 'Adult';
    case 'youth':
      return 'Youth';
    default: {
      const never: never = category;
      return never;
    }
  }
}

function tagsInNameOrder(ward: Ward): readonly { id: TagId; name: string }[] {
  return Object.values(ward.tags)
    .slice()
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id.localeCompare(right.id, 'en'),
    );
}

function placementText(person: PersonResult): string {
  if (person.placements.length === 0) {
    return 'No calling';
  }
  return person.placements.map((placement) => placement.title).join(' · ');
}

function inActiveDugout(person: PersonResult, activeId: BoardId): boolean {
  return person.dugout.some((entry) => entry.boardId === activeId);
}

function callingPath(boards: readonly Board[], calling: CallingResult): string {
  const board = boards.find((item) => item.id === calling.boardId);
  if (board === undefined) {
    return '';
  }
  const organization = board.boardGroups[calling.boardGroupId]?.name ?? '';
  const group = board.callingGroups[calling.callingGroupId]?.name ?? '';
  return `${organization} · ${group}`;
}

function callingState(ward: Ward, calling: CallingResult): { readonly label: string; readonly vacant: boolean } {
  const removed = calling.positions.some((position) => position.occupantRemoved);
  if (calling.vacantCount >= 1) {
    return { label: removed ? 'Vacant Removed' : 'Vacant', vacant: true };
  }
  const names: string[] = [];
  for (const position of calling.positions) {
    if (position.occupantId === null) {
      continue;
    }
    const name = ward.members[position.occupantId]?.name;
    if (name === undefined) {
      if (position.occupantRemoved) {
        names.push('Removed');
      }
      continue;
    }
    names.push(position.occupantRemoved ? `${name} Removed` : name);
  }
  if (names.length === 0) {
    return { label: removed ? 'Removed' : '', vacant: false };
  }
  return { label: names.join(' · '), vacant: false };
}

function rowKey(row: ResultRow): string {
  switch (row.kind) {
    case 'person':
      return `person:${row.person.memberId}`;
    case 'calling':
      return `calling:${row.calling.boardId}:${row.calling.assignmentId}`;
    case 'tag':
      return `tag:${row.tag.tagId}`;
    case 'group':
      return `group:${row.group.boardId}:${row.group.kind}:${row.group.id}`;
    default: {
      const never: never = row;
      return never;
    }
  }
}

function sectionTitle(row: ResultRow): string {
  switch (row.kind) {
    case 'person':
      return 'People';
    case 'calling':
      return 'Callings';
    case 'tag':
    case 'group':
      return 'Tags & groups';
    default: {
      const never: never = row;
      return never;
    }
  }
}

function targetFor(row: ResultRow): SearchTarget {
  switch (row.kind) {
    case 'person':
      return { kind: 'person', memberId: row.person.memberId };
    case 'calling':
      return {
        kind: 'calling',
        boardId: row.calling.boardId,
        callingGroupId: row.calling.callingGroupId,
        assignmentId: row.calling.assignmentId,
      };
    case 'tag':
      return { kind: 'tag', tagId: row.tag.tagId };
    case 'group':
      return { kind: 'group', boardId: row.group.boardId, groupKind: row.group.kind, id: row.group.id };
    default: {
      const never: never = row;
      return never;
    }
  }
}

function sectionsOf(rows: readonly ResultRow[]): readonly SectionBlock[] {
  const sections: SectionBlock[] = [];
  for (const [index, row] of rows.entries()) {
    const title = sectionTitle(row);
    const last = sections[sections.length - 1];
    const indexed = { row, index };
    if (last === undefined || last.title !== title) {
      sections.push({ title, rows: [indexed] });
      continue;
    }
    sections[sections.length - 1] = { title, rows: [...last.rows, indexed] };
  }
  return sections;
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') !== null;
}

function SearchIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function FilterChip({
  pressed,
  label,
  vacant = false,
  onClick,
}: {
  pressed: boolean;
  label: string;
  vacant?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={cx('wb-search-chip', pressed ? 'is-pressed' : undefined, pressed && vacant ? 'is-vacant' : undefined)}
      style={{ fontWeight: pressed ? 700 : 400 }}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {pressed ? `✓ ${label}` : label}
    </button>
  );
}

function ScopeButton({
  pressed,
  label,
  onClick,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={cx('wb-search-scope-button', pressed ? 'is-pressed' : undefined)}
      style={{ fontWeight: pressed ? 700 : 400, background: pressed ? '#FFFFFF' : 'transparent' }}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function SearchBox({
  ward,
  active,
  boards,
  readOnly,
  onNavigate,
  onAddToDugout,
  onHighlight,
  onClose,
}: SearchBoxProps): ReactElement {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [wide, setWide] = useState(false);
  const [filtersState, setFiltersState] = useState<FilterState>(INITIAL_FILTERS);
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;

  const appliedFilters = useMemo(() => toSearchFilters(filtersState), [filtersState]);
  const scopedBoards = wide ? boards : [active];
  const results = search({ query, boards: scopedBoards, filters: appliedFilters }, ward);
  const rows: readonly ResultRow[] = [
    ...results.people.map((person) => ({ kind: 'person' as const, person })),
    ...results.callings.map((calling) => ({ kind: 'calling' as const, calling })),
    ...results.tags.map((tag) => ({ kind: 'tag' as const, tag })),
    ...results.groups.map((group) => ({ kind: 'group' as const, group })),
  ];
  const resultKey = rows.map((row) => rowKey(row)).join('|');
  const selectedIndex = rows.length === 0 ? 0 : Math.min(selection.key === resultKey ? selection.index : 0, rows.length - 1);
  const open = !dismissed && (normalizedQuery(query) !== '' || filtersActive(filtersState));
  const tags = tagsInNameOrder(ward);
  const sections = sectionsOf(rows);

  useEffect(() => {
    onHighlightRef.current(filterMatches(active, ward, appliedFilters));
  }, [active, ward, appliedFilters]);

  useEffect(() => {
    if (!open || rows.length === 0) {
      return;
    }
    const node = document.getElementById(`${listboxId}-option-${String(selectedIndex)}`);
    if (node !== null && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, rows.length, selectedIndex, listboxId]);

  function updateFilters(update: (current: FilterState) => FilterState): void {
    setFiltersState(update);
    setDismissed(false);
  }

  function toggleTag(tagId: TagId): void {
    updateFilters((current) => {
      const tagIds = current.tagIds.includes(tagId)
        ? current.tagIds.filter((id) => id !== tagId)
        : [...current.tagIds, tagId];
      return { ...current, tagIds };
    });
  }

  function pressTag(tagId: TagId): void {
    updateFilters((current) => {
      if (current.tagIds.includes(tagId)) {
        return current;
      }
      return { ...current, tagIds: [...current.tagIds, tagId] };
    });
  }

  function move(delta: number): void {
    if (rows.length === 0) {
      return;
    }
    setSelection((current) => {
      const base = current.key === resultKey ? current.index : 0;
      const next = Math.min(rows.length - 1, Math.max(0, base + delta));
      return { key: resultKey, index: next };
    });
  }

  function choose(row: ResultRow): void {
    if (row.kind === 'tag') {
      pressTag(row.tag.tagId);
    }
    onNavigate(targetFor(row));
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      onClose();
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[selectedIndex];
      if (row !== undefined) {
        choose(row);
      }
    }
  }

  function renderRow(indexed: IndexedRow): ReactElement {
    const { row, index } = indexed;
    const selected = index === selectedIndex;
    const optionId = `${listboxId}-option-${String(index)}`;
    return (
      <div
        key={rowKey(row)}
        id={optionId}
        role="option"
        aria-selected={selected}
        className={cx('wb-search-option', selected ? 'is-selected' : undefined)}
        onMouseDown={(event) => {
          if (!isButtonTarget(event.target)) {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (isButtonTarget(event.target)) {
            return;
          }
          choose(row);
        }}
      >
        {renderRowBody(row)}
      </div>
    );
  }

  function renderRowBody(row: ResultRow): ReactNode {
    switch (row.kind) {
      case 'person':
        return renderPerson(row.person);
      case 'calling':
        return renderCalling(row.calling);
      case 'tag':
        return (
          <>
            <span className="wb-search-tag">{row.tag.name}</span>
            <span className="wb-search-meta">
              {`Tag · ${String(row.tag.memberIds.length)} people · select to highlight`}
            </span>
          </>
        );
      case 'group':
        return (
          <span className="wb-search-copy">
            <span className="wb-search-title">{row.group.name}</span>
            <span className="wb-search-meta">
              {`Group · ${String(row.group.positionCount)} positions, ${String(row.group.vacantCount)} vacant`}
            </span>
          </span>
        );
      default: {
        const never: never = row;
        return never;
      }
    }
  }

  function renderPerson(person: PersonResult): ReactElement {
    const member = ward.members[person.memberId];
    const name = member?.name ?? person.memberId;
    const category = member === undefined ? null : categoryLabel(member.category);
    const dugout = inActiveDugout(person, active.id);
    const canAdd = !readOnly && !active.dugoutInclusions.includes(person.memberId);
    return (
      <>
        <span className="wb-search-avatar" style={{ background: avatarColor(name) }} aria-hidden="true">
          {initials(name)}
        </span>
        <span className="wb-search-copy">
          <span className="wb-search-title">
            {name}
            {category === null ? null : <span className="wb-search-kind">{` · ${category}`}</span>}
          </span>
          <span className="wb-search-meta">{placementText(person)}</span>
        </span>
        {dugout ? <span className="wb-search-badge">In dugout</span> : null}
        {canAdd ? (
          <Button
            variant="secondary"
            className="wb-search-add"
            onClick={(event) => {
              event.stopPropagation();
              onAddToDugout({ memberId: person.memberId });
            }}
          >
            Add to dugout
          </Button>
        ) : null}
      </>
    );
  }

  function renderCalling(calling: CallingResult): ReactElement {
    const state = callingState(ward, calling);
    return (
      <>
        <span className="wb-search-copy">
          <span className="wb-search-title">{calling.title}</span>
          <span className="wb-search-meta">{callingPath(scopedBoards, calling)}</span>
        </span>
        {state.label === '' ? null : (
          <span className={cx('wb-search-status', state.vacant ? 'is-vacant' : undefined)}>{state.label}</span>
        )}
      </>
    );
  }

  return (
    <div className="wb-search">
      <div className={cx('wb-search-field', open ? 'is-open' : undefined)}>
        <SearchIcon />
        <input
          type="search"
          aria-label="Search people, callings, tags"
          placeholder="Search people, callings, tags"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && rows.length > 0 ? `${listboxId}-option-${String(selectedIndex)}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setDismissed(false);
          }}
          onKeyDown={onInputKeyDown}
        />
        {open ? <span className="wb-search-escape">Esc to close</span> : null}
      </div>
      <div className="wb-search-filters">
        <span className="wb-section-label">Filter</span>
        <FilterChip
          pressed={filtersState.vacant}
          label="Vacant positions"
          vacant
          onClick={() => {
            updateFilters((current) => ({ ...current, vacant: !current.vacant }));
          }}
        />
        <FilterChip
          pressed={filtersState.noCalling}
          label="No calling"
          onClick={() => {
            updateFilters((current) => ({ ...current, noCalling: !current.noCalling }));
          }}
        />
        <FilterChip
          pressed={filtersState.category === 'youth'}
          label="Youth"
          onClick={() => {
            updateFilters((current) => ({
              ...current,
              category: current.category === 'youth' ? null : 'youth',
            }));
          }}
        />
        <FilterChip
          pressed={filtersState.category === 'adult'}
          label="Adults"
          onClick={() => {
            updateFilters((current) => ({
              ...current,
              category: current.category === 'adult' ? null : 'adult',
            }));
          }}
        />
        {tags.map((tag) => (
          <FilterChip
            key={tag.id}
            pressed={filtersState.tagIds.includes(tag.id)}
            label={`Tag: ${tag.name}`}
            onClick={() => {
              toggleTag(tag.id);
            }}
          />
        ))}
        <p className="wb-search-filter-note">Filters highlight matches on the board; they never change placements.</p>
      </div>
      {open ? (
        <div className="wb-search-panel">
          <div className="wb-search-panel-bar">
            <div role="group" aria-label="Search scope" className="wb-search-scope">
              <ScopeButton
                pressed={!wide}
                label={singleScopeLabel(active.kind)}
                onClick={() => {
                  setWide(false);
                }}
              />
              <ScopeButton
                pressed={wide}
                label="All proposals & Current"
                onClick={() => {
                  setWide(true);
                }}
              />
            </div>
            <span className="wb-search-count">{`${String(rows.length)} results`}</span>
          </div>
          <div id={listboxId} role="listbox" aria-label="Search results" className="wb-search-list">
            {rows.length === 0 ? <p className="wb-search-empty">No matches</p> : null}
            {sections.map((section) => (
              <section key={section.title} className="wb-search-section">
                <h3 className="wb-section-label wb-search-heading">{section.title}</h3>
                {section.rows.map((indexed) => renderRow(indexed))}
              </section>
            ))}
          </div>
          <p className="wb-search-footnote">↑↓ to move · Enter to go there · note text isn't searched</p>
        </div>
      ) : null}
    </div>
  );
}
