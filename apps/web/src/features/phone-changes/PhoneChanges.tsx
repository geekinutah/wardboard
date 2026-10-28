import type { ReactElement } from 'react';
import type { PhoneChangesModel } from './model.ts';
import './phone-changes.css';

export interface PhoneChangesProps {
  readonly model: PhoneChangesModel | null; // null when viewing Current
  readonly onAccept: () => void;
  readonly onReopen?: (() => void) | undefined;
}

export function PhoneChanges({ model, onAccept, onReopen }: PhoneChangesProps): ReactElement {
  if (model === null) {
    return (
      <div className="wb-phone-changes">
        <header className="wb-phone-changes-header">
          <h1 className="wb-phone-changes-title">Changes</h1>
        </header>
        <main className="wb-phone-changes-content">
          <p className="wb-phone-changes-current-note">
            Current is the baseline reference board and has no proposed changes.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="wb-phone-changes">
      <header className="wb-phone-changes-header">
        <h1 className="wb-phone-changes-title">Changes</h1>
        <span className="wb-phone-changes-subtitle">{model.subtitle}</span>
      </header>

      <main className="wb-phone-changes-content">
        {model.removedItems.length > 0 && (
          <section
            aria-labelledby="wb-phone-changes-removed-heading"
            className="wb-phone-changes-removed"
          >
            <h2
              id="wb-phone-changes-removed-heading"
              className="wb-phone-changes-removed-title"
            >
              Removed from Current · {model.removedItems.length}
            </h2>
            {model.removedItems.map((item) => (
              <div key={item.key} className="wb-phone-changes-removed-row">
                <div className="wb-phone-changes-removed-text">
                  <span className="wb-phone-changes-removed-headline">{item.headline}</span>
                  <span className="wb-phone-changes-removed-detail">{item.detail}</span>
                </div>
                <span
                  aria-hidden="true"
                  className="wb-phone-changes-removed-watermark"
                >
                  {item.kind === 'member' ? 'REMOVED' : 'POSITION REMOVED'}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Section 1: Suggested callings */}
        <details
          className="wb-phone-changes-section"
          open={model.callings.length > 0}
        >
          <summary className="wb-phone-changes-summary">
            <span className="wb-phone-changes-sign wb-phone-changes-sign-callings">+</span>
            <span className="wb-phone-changes-section-title">Suggested callings</span>
            <span className="wb-phone-changes-section-count">{model.callings.length}</span>
          </summary>
          <div className="wb-phone-changes-rows">
            {model.callings.length === 0 ? (
              <div className="wb-phone-changes-empty">None</div>
            ) : (
              model.callings.map((row) => (
                <div key={row.key} className="wb-phone-changes-row">
                  <span className="wb-phone-changes-row-who">{row.who}</span>
                  <span className="wb-phone-changes-row-what">{row.what}</span>
                </div>
              ))
            )}
          </div>
        </details>

        {/* Section 2: Suggested releases */}
        <details
          className="wb-phone-changes-section"
          open={model.callings.length === 0 && model.releases.length > 0}
        >
          <summary className="wb-phone-changes-summary">
            <span className="wb-phone-changes-sign wb-phone-changes-sign-releases">{'\u2212'}</span>
            <span className="wb-phone-changes-section-title">Suggested releases</span>
            <span className="wb-phone-changes-section-count">{model.releases.length}</span>
          </summary>
          <div className="wb-phone-changes-rows">
            {model.releases.length === 0 ? (
              <div className="wb-phone-changes-empty">None</div>
            ) : (
              model.releases.map((row) => (
                <div key={row.key} className="wb-phone-changes-row">
                  <span className="wb-phone-changes-row-who">{row.who}</span>
                  <span className="wb-phone-changes-row-what">{row.what}</span>
                </div>
              ))
            )}
          </div>
        </details>

        {/* Section 3: Position changes */}
        <details className="wb-phone-changes-section">
          <summary className="wb-phone-changes-summary">
            <span className="wb-phone-changes-sign wb-phone-changes-sign-positions">{'\u00B1'}</span>
            <span className="wb-phone-changes-section-title">Position changes</span>
            <span className="wb-phone-changes-section-count">{model.positionChanges.length}</span>
          </summary>
          <div className="wb-phone-changes-rows">
            {model.positionChanges.length === 0 ? (
              <div className="wb-phone-changes-empty">None</div>
            ) : (
              model.positionChanges.map((row) => (
                <div key={row.key} className="wb-phone-changes-row">
                  <span className="wb-phone-changes-row-who">{row.who}</span>
                  <span className="wb-phone-changes-row-what">{row.what}</span>
                </div>
              ))
            )}
          </div>
        </details>
      </main>

      <footer className="wb-phone-changes-footer">
        {model.status === 'draft' ? (
          <>
            <button
              type="button"
              className="wb-phone-changes-accept-button"
              disabled={!model.canAccept}
              onClick={onAccept}
            >
              Accept proposal
            </button>
            {model.acceptBlockReason !== null && (
              <p className="wb-phone-changes-block-reason">{model.acceptBlockReason}</p>
            )}
          </>
        ) : (
          <div className="wb-phone-changes-accepted-bar">
            <span className="wb-phone-changes-accepted-status">Accepted · read-only</span>
            {onReopen !== undefined && (
              <button
                type="button"
                className="wb-phone-changes-reopen-button"
                onClick={onReopen}
              >
                Return to Draft
              </button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
