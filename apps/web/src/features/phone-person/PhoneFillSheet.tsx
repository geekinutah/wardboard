import { useEffect, useId, type ReactElement } from 'react';
import { avatarColor, initials } from '../../design/person.ts';
import type { PhoneFillCandidateRow } from './model.ts';
import './phone-person.css';

export interface PhoneFillSheetProps {
  /** The vacant calling's title. */
  readonly title: string;
  /** Its organization, as the move sheet labels it. */
  readonly orgLabel: string;
  /** Rows already filtered by `query` (see `buildFillCandidates`). */
  readonly candidates: readonly PhoneFillCandidateRow[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (memberId: string) => void;
  readonly onCancel: () => void;
}

function SearchIcon(): ReactElement {
  return (
    <svg className="wb-phone-move-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Tap a vacancy on the phone: choose someone from the dugout to fill it. */
export function PhoneFillSheet({
  title,
  orgLabel,
  candidates,
  query,
  onQueryChange,
  onSelect,
  onCancel,
}: PhoneFillSheetProps): ReactElement {
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  const empty = query.trim() === '' ? 'No one in the dugout.' : 'No matching people.';

  return (
    <>
      <div className="wb-phone-sheet-scrim" onClick={onCancel} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="wb-phone-sheet-dialog">
        <span className="wb-phone-sheet-handle" aria-hidden="true" />

        <div className="wb-phone-move-header">
          <h2 id={titleId} className="wb-phone-move-title">
            Fill {title}
          </h2>
          <span className="wb-phone-move-subtitle">{orgLabel}</span>
        </div>

        <label className="wb-phone-move-search-label">
          <SearchIcon />
          <input
            type="search"
            aria-label="Find a person"
            placeholder="Find a person…"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            className="wb-phone-move-search-input"
          />
        </label>

        <span className="wb-section-label">Dugout</span>

        {candidates.length === 0 ? (
          <p className="wb-phone-move-empty">{empty}</p>
        ) : (
          <div className="wb-phone-move-destinations">
            {candidates.map((row) => {
              const matches = row.matchedTagNames.join(', ');
              const matchSuffix = matches === '' ? '' : `, Matches ${matches}`;
              return (
                <button
                  type="button"
                  key={row.memberId}
                  className="wb-phone-fill-row"
                  aria-label={`${row.name}, ${row.detail}${matchSuffix}`}
                  onClick={() => {
                    onSelect(row.memberId);
                  }}
                >
                  <span className="wb-phone-fill-avatar" style={{ backgroundColor: avatarColor(row.name) }} aria-hidden="true">
                    {initials(row.name)}
                  </span>
                  <span className="wb-phone-move-dest-info">
                    <span className="wb-phone-move-dest-title">{row.name}</span>
                    <span className="wb-phone-move-dest-org">{row.detail}</span>
                  </span>
                  {matches === '' ? null : <span className="wb-phone-move-dest-badge">Matches {matches}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="wb-phone-move-actions">
          <button type="button" className="wb-phone-move-action-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
