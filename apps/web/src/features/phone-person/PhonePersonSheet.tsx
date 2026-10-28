import { useEffect, useId, type ReactElement } from 'react';
import { avatarColor, initials } from '../../design/person.ts';
import type { PhonePersonSheetModel } from './model.ts';
import './phone-person.css';

export interface PhonePersonSheetProps {
  readonly model: PhonePersonSheetModel;
  readonly boardName: string;
  readonly editable: boolean;
  readonly onStartMove: (positionId: string) => void;
  readonly onRelease: (positionId: string) => void;
  readonly onAddToDugout: () => void;
  readonly onPlaceFromDugout?: () => void;
  readonly onOpenProfile: () => void;
  readonly onClose: () => void;
}

function CloseIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function PhonePersonSheet({
  model,
  boardName,
  editable,
  onStartMove,
  onRelease,
  onAddToDugout,
  onPlaceFromDugout,
  onOpenProfile,
  onClose,
}: PhonePersonSheetProps): ReactElement {
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <>
      <div className="wb-phone-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="wb-phone-sheet-dialog"
      >
        <span className="wb-phone-sheet-handle" aria-hidden="true" />

        <div className="wb-phone-person-header">
          <span
            className="wb-phone-person-avatar"
            style={{ backgroundColor: avatarColor(model.name) }}
            aria-hidden="true"
          >
            {initials(model.name)}
          </span>
          <div className="wb-phone-person-info">
            <h2 id={titleId} className="wb-phone-person-name">
              {model.name} <span className="wb-phone-person-category">· {model.categoryLabel}</span>
            </h2>
            <div className="wb-phone-person-tags">
              {model.tagNames.map((tag) => (
                <span key={tag} className="wb-phone-person-tag">
                  {tag}
                </span>
              ))}
              {model.needsApproval ? (
                <span className="wb-phone-person-needs-approval">Needs approval</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="wb-phone-sheet-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="wb-phone-person-section">
          <h3 className="wb-phone-person-section-title">Callings in {boardName}</h3>
          {model.callings.length === 0 ? (
            <>
              <p className="wb-phone-person-empty">No callings in this proposal.</p>
              {editable && onPlaceFromDugout !== undefined ? (
                <button
                  type="button"
                  className="wb-phone-person-assign-btn"
                  onClick={onPlaceFromDugout}
                >
                  Assign calling…
                </button>
              ) : null}
            </>
          ) : (
            model.callings.map((calling) => (
              <div key={calling.positionId} className="wb-phone-person-calling-card">
                <span className="wb-phone-person-calling-title">{calling.title}</span>
                <span className="wb-phone-person-calling-org">{calling.orgLabel}</span>
                {editable ? (
                  <div className="wb-phone-person-calling-actions">
                    <button
                      type="button"
                      className="wb-phone-person-btn"
                      aria-label={`Move from ${calling.title}`}
                      onClick={() => {
                        onStartMove(calling.positionId);
                      }}
                    >
                      Move…
                    </button>
                    <button
                      type="button"
                      className="wb-phone-person-btn"
                      aria-label={`Release from ${calling.title}`}
                      onClick={() => {
                        onRelease(calling.positionId);
                      }}
                    >
                      Release
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {model.externalCallings.length > 0 ? (
          <div className="wb-phone-person-section">
            <h3 className="wb-phone-person-section-title">Outside the ward</h3>
            <ul className="wb-phone-person-outside-list">
              {model.externalCallings.map((external, index) => (
                <li key={index} className="wb-phone-person-outside-item">
                  {external.unit} · {external.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {editable && !model.inExplicitDugout ? (
          <button
            type="button"
            className="wb-phone-person-dugout-btn"
            onClick={onAddToDugout}
          >
            <span>Add to dugout</span>
            <span className="wb-phone-person-dugout-sub">keeps current callings</span>
          </button>
        ) : null}

        {model.inExplicitDugout ? (
          <div className="wb-phone-person-in-dugout">In dugout</div>
        ) : null}

        <button
          type="button"
          className="wb-phone-person-profile-btn"
          onClick={onOpenProfile}
        >
          Profile, note & photo
        </button>
      </div>
    </>
  );
}
