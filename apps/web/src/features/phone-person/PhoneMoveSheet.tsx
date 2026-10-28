import { useEffect, useId, type ReactElement } from 'react';
import type { PhoneVacantDestinationRow } from './model.ts';
import './phone-person.css';

export interface PhoneMoveSheetProps {
  readonly memberName: string;
  readonly sourceCalling: { readonly positionId: string; readonly title: string; readonly orgLabel: string } | null;
  readonly destinations: readonly PhoneVacantDestinationRow[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectDestination: (target: PhoneVacantDestinationRow['target']) => void;
  readonly onSendToDugout: (() => void) | null;
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

export function PhoneMoveSheet({
  memberName,
  sourceCalling,
  destinations,
  query,
  onQueryChange,
  onSelectDestination,
  onSendToDugout,
  onCancel,
}: PhoneMoveSheetProps): ReactElement {
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

  return (
    <>
      <div className="wb-phone-sheet-scrim" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="wb-phone-sheet-dialog"
      >
        <span className="wb-phone-sheet-handle" aria-hidden="true" />

        <div className="wb-phone-move-header">
          <h2 id={titleId} className="wb-phone-move-title">
            Move {memberName}
          </h2>
          <span className="wb-phone-move-subtitle">
            {sourceCalling !== null
              ? `Releases from ${sourceCalling.orgLabel} \u00B7 ${sourceCalling.title}. Tap a destination.`
              : `Tap a vacant calling to place ${memberName}.`}
          </span>
        </div>

        <label className="wb-phone-move-search-label">
          <span className="wb-sr-only">Find a calling</span>
          <SearchIcon />
          <input
            type="search"
            aria-label="Find a calling"
            placeholder="Find a calling…"
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
            }}
            className="wb-phone-move-search-input"
          />
        </label>

        <span className="wb-section-label">Vacant positions</span>

        {destinations.length === 0 ? (
          <p className="wb-phone-move-empty">No matching vacant positions.</p>
        ) : (
          <div className="wb-phone-move-destinations">
            {destinations.map((row) => {
              const matchSuffix =
                row.matchedTagNames.length > 0 ? `, Matches ${row.matchedTagNames.join(', ')}` : '';
              return (
                <button
                  type="button"
                  key={row.key}
                  className="wb-phone-move-dest-btn"
                  aria-label={`${row.title}, ${row.orgLabel}${matchSuffix}`}
                  onClick={() => {
                    onSelectDestination(row.target);
                  }}
                >
                  <span className="wb-phone-move-dest-info">
                    <span className="wb-phone-move-dest-title">{row.title}</span>
                    <span className="wb-phone-move-dest-org">{row.orgLabel}</span>
                  </span>
                  {row.matchedTagNames.length > 0 ? (
                    <span className="wb-phone-move-dest-badge">
                      Matches {row.matchedTagNames.join(', ')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="wb-phone-move-actions">
          {sourceCalling !== null && onSendToDugout !== null ? (
            <button
              type="button"
              className="wb-phone-move-action-btn"
              onClick={onSendToDugout}
            >
              Send to dugout
            </button>
          ) : null}
          <button
            type="button"
            className="wb-phone-move-action-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
