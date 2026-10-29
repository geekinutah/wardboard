import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { switcherSubtitle, type BoardEntry } from './summary.ts';
import './phone-shell.css';

export type PhoneTab = 'board' | 'search' | 'dugout' | 'changes';

export interface PhoneShellProps {
  boards: readonly BoardEntry[];
  activeBoardId: string;
  summary: string;
  activeTab: PhoneTab;
  onTabChange: (tab: PhoneTab) => void;
  dugoutCount: number;
  onSelectBoard: (id: string) => void;
  onStartProposal: () => void;
  canStartProposal: boolean;
  children: ReactNode;
}

function BoardIcon(): ReactElement {
  return (
    <svg className="wb-phone-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SearchIcon(): ReactElement {
  return (
    <svg className="wb-phone-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function DugoutIcon(): ReactElement {
  return (
    <svg className="wb-phone-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

function ChangesIcon(): ReactElement {
  return (
    <svg className="wb-phone-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v6M9 8h6M9 17h6" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

function ChevronDownIcon(): ReactElement {
  return (
    <svg className="wb-phone-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function PhoneShell({
  boards,
  activeBoardId,
  summary,
  activeTab,
  onTabChange,
  dugoutCount,
  onSelectBoard,
  onStartProposal,
  canStartProposal,
  children,
}: PhoneShellProps): ReactElement {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const boardName = activeBoard !== undefined ? activeBoard.name : 'Unknown board';

  let statusLabel: string | null = null;
  let statusClass = '';
  if (activeBoard !== undefined) {
    if (activeBoard.status === 'draft') {
      statusLabel = 'PROPOSED';
      statusClass = 'wb-status-proposed';
    } else if (activeBoard.status === 'accepted') {
      statusLabel = 'ACCEPTED';
      statusClass = 'wb-status-accepted';
    } else {
      statusLabel = 'CURRENT';
      statusClass = 'wb-status-current';
    }
  }

  // Focus management: move focus into dialog on open, return to trigger on close
  useEffect(() => {
    if (isSwitcherOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isSwitcherOpen]);

  const closeSwitcher = () => {
    setIsSwitcherOpen(false);
    triggerButtonRef.current?.focus();
  };

  const handleSelect = (id: string) => {
    if (id !== activeBoardId) {
      onSelectBoard(id);
    }
    closeSwitcher();
  };

  const handleStartProposal = () => {
    onStartProposal();
    closeSwitcher();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSwitcher();
    }
  };

  const currentBoard = boards.find((b) => b.kind === 'current');
  const proposals = boards.filter((b) => b.kind === 'proposal');

  const changesLabel =
    activeBoard !== undefined && activeBoard.kind === 'proposal'
      ? activeBoard.changeCount === null
        ? 'Changes'
        : `Changes · ${String(activeBoard.changeCount)}`
      : 'Changes';

  return (
    <div className="wb-phone-shell">
      <header className="wb-phone-shell-header">
        <div className="wb-phone-header-top">
          <button
            type="button"
            ref={triggerButtonRef}
            className="wb-phone-board-switcher-btn"
            aria-label={`Switch board, current board ${boardName}`}
            onClick={() => {
              setIsSwitcherOpen(true);
            }}
          >
            {statusLabel !== null && (
              <span className={`wb-phone-status-badge ${statusClass}`}>
                {statusLabel}
              </span>
            )}
            <h1 className="wb-phone-board-title">{boardName}</h1>
            <ChevronDownIcon />
          </button>
        </div>
        <p className="wb-phone-header-summary">{summary}</p>
      </header>

      <main className="wb-phone-shell-main">{children}</main>

      <nav className="wb-phone-shell-nav" aria-label="Board sections">
        <button
          type="button"
          className={`wb-phone-nav-tab ${activeTab === 'board' ? 'wb-active' : ''}`}
          aria-current={activeTab === 'board' ? 'page' : undefined}
          onClick={() => {
            onTabChange('board');
          }}
        >
          <BoardIcon />
          <span className="wb-phone-tab-label">Board</span>
        </button>
        <button
          type="button"
          className={`wb-phone-nav-tab ${activeTab === 'search' ? 'wb-active' : ''}`}
          aria-current={activeTab === 'search' ? 'page' : undefined}
          onClick={() => {
            onTabChange('search');
          }}
        >
          <SearchIcon />
          <span className="wb-phone-tab-label">Search</span>
        </button>
        <button
          type="button"
          className={`wb-phone-nav-tab ${activeTab === 'dugout' ? 'wb-active' : ''}`}
          aria-current={activeTab === 'dugout' ? 'page' : undefined}
          onClick={() => {
            onTabChange('dugout');
          }}
        >
          <DugoutIcon />
          <span className="wb-phone-tab-label">Dugout · {dugoutCount}</span>
        </button>
        <button
          type="button"
          className={`wb-phone-nav-tab ${activeTab === 'changes' ? 'wb-active' : ''}`}
          aria-current={activeTab === 'changes' ? 'page' : undefined}
          onClick={() => {
            onTabChange('changes');
          }}
        >
          <ChangesIcon />
          <span className="wb-phone-tab-label">{changesLabel}</span>
        </button>
      </nav>

      {isSwitcherOpen && (
        <div
          className="wb-phone-switcher-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeSwitcher();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wb-phone-switcher-heading"
            className="wb-phone-switcher-dialog"
            onKeyDown={handleKeyDown}
          >
            <span className="wb-phone-switcher-drag-handle" aria-hidden="true" />
            <div className="wb-phone-switcher-header">
              <h2 id="wb-phone-switcher-heading" className="wb-phone-switcher-title">
                Boards
              </h2>
              <button
                type="button"
                ref={closeButtonRef}
                className="wb-phone-switcher-close-btn"
                onClick={() => {
                  closeSwitcher();
                }}
                aria-label="Close"
              >
                Close
              </button>
            </div>

            {currentBoard !== undefined && (
              <button
                type="button"
                className={`wb-phone-board-option ${
                  currentBoard.id === activeBoardId ? 'wb-active' : ''
                }`}
                aria-current={currentBoard.id === activeBoardId ? 'page' : undefined}
                onClick={() => {
                  handleSelect(currentBoard.id);
                }}
              >
                <div className="wb-phone-board-option-info">
                  <span className="wb-phone-board-option-name">{currentBoard.name}</span>
                  <span className="wb-phone-board-option-sub">
                    {switcherSubtitle(currentBoard)}
                  </span>
                </div>
                {currentBoard.id === activeBoardId && (
                  <span className="wb-phone-switcher-viewing-badge">Viewing</span>
                )}
              </button>
            )}

            <h3 className="wb-phone-switcher-section-title">Proposals</h3>

            {proposals.length === 0 ? (
              <p className="wb-phone-switcher-empty">No proposals yet.</p>
            ) : (
              <div className="wb-phone-switcher-proposals-list">
                {proposals.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`wb-phone-board-option ${
                      entry.id === activeBoardId ? 'wb-active' : ''
                    }`}
                    aria-current={entry.id === activeBoardId ? 'page' : undefined}
                    onClick={() => {
                      handleSelect(entry.id);
                    }}
                  >
                    <div className="wb-phone-board-option-info">
                      <span className="wb-phone-board-option-name">{entry.name}</span>
                      <span className="wb-phone-board-option-sub">
                        {switcherSubtitle(entry)}
                      </span>
                    </div>
                    {entry.id === activeBoardId && (
                      <span className="wb-phone-switcher-viewing-badge">Viewing</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {canStartProposal && (
              <button
                type="button"
                className="wb-phone-start-proposal-btn"
                onClick={() => {
                  handleStartProposal();
                }}
              >
                <PlusIcon />
                Start proposal
              </button>
            )}

            <p className="wb-phone-switcher-footnote">
              Each person picks their own board; switching here never changes anyone else&apos;s view.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
