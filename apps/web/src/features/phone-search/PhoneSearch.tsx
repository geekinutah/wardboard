import { useState, type ReactElement } from 'react';
import {
  dugout,
  search,
  type Board,
  type MemberCategory,
  type TagId,
  type Ward,
} from '@wardboard/core';
import { avatarColor, initials } from '../../design/person.ts';
import './phone-search.css';

export type PhoneSearchTarget =
  | { readonly kind: 'person'; readonly memberId: string }
  | {
      readonly kind: 'calling';
      readonly boardId: string;
      readonly boardGroupId: string;
      readonly callingGroupId: string;
      readonly assignmentId: string;
    }
  | { readonly kind: 'tag'; readonly tagId: string }
  | {
      readonly kind: 'group';
      readonly boardId: string;
      readonly groupKind: 'boardGroup' | 'callingGroup';
      readonly id: string;
    };

export interface PhoneSearchProps {
  readonly ward: Ward;
  readonly activeBoard: Board;
  readonly allBoards: readonly Board[];
  readonly editable: boolean;
  readonly initialQuery?: string;
  readonly onSelectResult: (target: PhoneSearchTarget) => void;
  readonly onAddToDugout: (memberId: string) => void;
}

interface FilterState {
  readonly vacant: boolean;
  readonly noCalling: boolean;
  readonly category: MemberCategory | undefined;
  readonly tagIds: readonly TagId[];
}

function SearchIcon(): ReactElement {
  return (
    <svg
      className="wb-phone-search-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function PhoneSearch({
  ward,
  activeBoard,
  allBoards,
  editable,
  initialQuery = '',
  onSelectResult,
  onAddToDugout,
}: PhoneSearchProps): ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [filters, setFilters] = useState<FilterState>({
    vacant: false,
    noCalling: false,
    category: undefined,
    tagIds: [],
  });

  const scopedBoards = scope === 'all' ? allBoards : [activeBoard];
  const activeFilters: {
    vacant?: boolean;
    noCalling?: boolean;
    category?: MemberCategory;
    tagIds?: readonly TagId[];
  } = {};
  if (filters.vacant) activeFilters.vacant = true;
  if (filters.noCalling) activeFilters.noCalling = true;
  if (filters.category !== undefined) activeFilters.category = filters.category;
  if (filters.tagIds.length > 0) activeFilters.tagIds = filters.tagIds;

  const results = search(
    {
      query,
      boards: scopedBoards,
      filters: activeFilters,
    },
    ward,
  );

  const isQueryEmpty = query.trim() === '';
  const noFiltersActive =
    !filters.vacant && !filters.noCalling && !filters.category && filters.tagIds.length === 0;
  const showPrompt = isQueryEmpty && noFiltersActive;
  const noMatches =
    !showPrompt &&
    results.people.length === 0 &&
    results.callings.length === 0 &&
    results.tags.length === 0 &&
    results.groups.length === 0;

  const hasResults =
    !showPrompt &&
    !noMatches &&
    (results.people.length > 0 ||
      results.callings.length > 0 ||
      results.tags.length > 0 ||
      results.groups.length > 0);

  const singleScopeLabel = activeBoard.kind === 'proposal' ? 'This proposal' : (activeBoard.kind === 'current' ? 'Current' : 'Baseline');

  const removeTag = (tagIdToRemove: TagId): void => {
    setFilters((prev) => ({
      ...prev,
      tagIds: prev.tagIds.filter((id) => id !== tagIdToRemove),
    }));
  };

  const toggleTag = (tagIdToToggle: TagId): void => {
    setFilters((prev) => {
      const exists = prev.tagIds.includes(tagIdToToggle);
      return {
        ...prev,
        tagIds: exists
          ? prev.tagIds.filter((id) => id !== tagIdToToggle)
          : [...prev.tagIds, tagIdToToggle],
      };
    });
  };

  return (
    <div className="wb-phone-search">
      <header className="wb-phone-search-header">
        <label className="wb-phone-search-input-wrap">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search"
            placeholder="Search people, callings, tags…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="wb-phone-search-input"
          />
        </label>
        <div className="wb-phone-search-filters" role="toolbar" aria-label="Search filters">
          <button
            type="button"
            aria-pressed={scope === 'active'}
            className={`wb-phone-filter-chip ${scope === 'active' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setScope('active');
            }}
          >
            {scope === 'active' ? `✓ ${singleScopeLabel}` : singleScopeLabel}
          </button>
          <button
            type="button"
            aria-pressed={scope === 'all'}
            className={`wb-phone-filter-chip ${scope === 'all' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setScope('all');
            }}
          >
            {scope === 'all' ? '✓ All' : 'All'}
          </button>
          <button
            type="button"
            aria-pressed={filters.vacant}
            className={`wb-phone-filter-chip ${filters.vacant ? 'wb-pressed' : ''}`}
            onClick={() => {
              setFilters((prev) => ({ ...prev, vacant: !prev.vacant }));
            }}
          >
            {filters.vacant ? '✓ Vacant' : 'Vacant'}
          </button>
          <button
            type="button"
            aria-pressed={filters.noCalling}
            className={`wb-phone-filter-chip ${filters.noCalling ? 'wb-pressed' : ''}`}
            onClick={() => {
              setFilters((prev) => ({ ...prev, noCalling: !prev.noCalling }));
            }}
          >
            {filters.noCalling ? '✓ No calling' : 'No calling'}
          </button>
          <button
            type="button"
            aria-pressed={filters.category === 'youth'}
            className={`wb-phone-filter-chip ${filters.category === 'youth' ? 'wb-pressed' : ''}`}
            onClick={() => {
              setFilters((prev) => ({
                ...prev,
                category: prev.category === 'youth' ? undefined : 'youth',
              }));
            }}
          >
            {filters.category === 'youth' ? '✓ Youth' : 'Youth'}
          </button>
          {filters.tagIds.map((tagId) => {
            const tagName = ward.tags[tagId]?.name ?? tagId;
            return (
              <button
                key={tagId}
                type="button"
                aria-pressed="true"
                className="wb-phone-filter-chip wb-pressed"
                onClick={() => {
                  removeTag(tagId);
                }}
              >
                ✓ Tag: {tagName}
              </button>
            );
          })}
        </div>
      </header>

      <div className="wb-phone-search-results">
        {showPrompt && (
          <p className="wb-phone-search-helper">
            Type a name, calling, or tag, or choose a filter.
          </p>
        )}

        {noMatches && <p className="wb-phone-search-empty">No matches.</p>}

        {results.people.length > 0 && (
          <>
            <h2 className="wb-phone-search-heading">People</h2>
            <div className="wb-phone-search-card">
              {results.people.map((person) => {
                const member = ward.members[person.memberId];
                const name = member?.name ?? person.memberId;
                const isYouth = member?.category === 'youth';

                let titles: string;
                if (person.placements.length > 0) {
                  titles = person.placements.map((p) => p.title).join(' · ');
                } else if (member && member.externalCallings.length > 0) {
                  titles = member.externalCallings.map((c) => `${c.unit} · ${c.title}`).join(' · ');
                } else {
                  titles = 'No calling';
                }

                const subtitle = isYouth ? `Youth · ${titles}` : titles;

                const inActiveDugout =
                  person.dugout.some((d) => d.boardId === activeBoard.id) ||
                  dugout(activeBoard, ward).some((d) => d.memberId === person.memberId);

                return (
                  <div key={person.memberId} className="wb-phone-search-row">
                    <button
                      type="button"
                      className="wb-phone-search-row-main"
                      onClick={() => {
                        onSelectResult({ kind: 'person', memberId: person.memberId });
                      }}
                    >
                      <span
                        className="wb-phone-search-avatar"
                        aria-hidden="true"
                        style={{ backgroundColor: avatarColor(name) }}
                      >
                        {initials(name)}
                      </span>
                      <span className="wb-phone-search-info">
                        <span className="wb-phone-search-name">{name}</span>
                        <span className="wb-phone-search-sub">{subtitle}</span>
                      </span>
                    </button>
                    {inActiveDugout ? (
                      <span className="wb-phone-search-in-dugout">In dugout</span>
                    ) : editable ? (
                      <button
                        type="button"
                        className="wb-phone-search-add-dugout-btn"
                        aria-label={`Add ${name} to dugout`}
                        onClick={() => {
                          onAddToDugout(person.memberId);
                        }}
                      >
                        + Dugout
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {results.callings.length > 0 && (
          <>
            <h2 className="wb-phone-search-heading">Callings</h2>
            <div className="wb-phone-search-card">
              {results.callings.map((calling) => {
                const callingBoard =
                  allBoards.find((b) => b.id === calling.boardId) ?? activeBoard;
                const boardGroup = callingBoard.boardGroups[calling.boardGroupId];
                const callingGroup = callingBoard.callingGroups[calling.callingGroupId];
                const bgName = boardGroup?.name ?? '';
                const cgName = callingGroup?.name ?? '';
                const groupText =
                  bgName === cgName || !cgName
                    ? bgName
                    : !bgName
                      ? cgName
                      : `${bgName} · ${cgName}`;

                let stateText: string;
                let isVacant = false;
                if (calling.vacantCount >= 1) {
                  stateText = 'Vacant';
                  isVacant = true;
                } else {
                  const names: string[] = [];
                  for (const position of calling.positions) {
                    if (position.occupantId === null) continue;
                    const m = ward.members[position.occupantId];
                    if (m !== undefined) {
                      names.push(
                        position.occupantRemoved ? `${m.name} (Removed)` : m.name,
                      );
                    } else if (position.occupantRemoved) {
                      names.push('Removed');
                    }
                  }
                  stateText = names.join(', ');
                }

                return (
                  <button
                    key={`${calling.boardId}:${calling.assignmentId}`}
                    type="button"
                    className="wb-phone-search-row-calling"
                    onClick={() => {
                      onSelectResult({
                        kind: 'calling',
                        boardId: calling.boardId,
                        boardGroupId: calling.boardGroupId,
                        callingGroupId: calling.callingGroupId,
                        assignmentId: calling.assignmentId,
                      });
                    }}
                  >
                    <span className="wb-phone-search-calling-text">
                      <span className="wb-phone-search-calling-title">{calling.title}</span>{' '}
                      <span className="wb-phone-search-calling-group">{groupText}</span>
                    </span>{' '}
                    <span
                      className={`wb-phone-search-calling-state ${
                        isVacant ? 'wb-state-vacant' : 'wb-state-filled'
                      }`}
                    >
                      {stateText}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {(results.tags.length > 0 || results.groups.length > 0) && (
          <>
            <h2 className="wb-phone-search-heading">Tags</h2>
            <div className="wb-phone-search-card">
              {results.tags.map((tag) => (
                <button
                  key={tag.tagId}
                  type="button"
                  className="wb-phone-search-row-tag"
                  onClick={() => {
                    toggleTag(tag.tagId);
                    onSelectResult({ kind: 'tag', tagId: tag.tagId });
                  }}
                >
                  <span className="wb-phone-search-tag-badge">{tag.name}</span>
                  <span className="wb-phone-search-tag-count">
                    {tag.memberIds.length} {tag.memberIds.length === 1 ? 'person' : 'people'} · show
                    them
                  </span>
                </button>
              ))}
              {results.groups.map((group) => (
                <button
                  key={`${group.boardId}:${group.kind}:${group.id}`}
                  type="button"
                  className="wb-phone-search-row-group"
                  onClick={() => {
                    onSelectResult({
                      kind: 'group',
                      boardId: group.boardId,
                      groupKind: group.kind,
                      id: group.id,
                    });
                  }}
                >
                  <span className="wb-phone-search-calling-text">
                    <span className="wb-phone-search-calling-title">{group.name}</span>
                    <span className="wb-phone-search-calling-group">
                      Group · {group.positionCount} positions, {group.vacantCount} vacant
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {hasResults && (
          <p className="wb-phone-search-footer-note">Note text isn&apos;t searched.</p>
        )}
      </div>
    </div>
  );
}
