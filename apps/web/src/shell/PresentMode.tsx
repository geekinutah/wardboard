import { useEffect, type ReactElement } from 'react';
import type { Board, Ward } from '@wardboard/core';
import { Presentation, type PresentationStatus } from '../features/presentation/Presentation.tsx';

export interface PresentModeProps {
  board: Board;
  ward: Ward;
  baseline: Board | null;
  title: string;
  status: PresentationStatus;
  baselineCapturedAt: string | null;
  showNeedsApproval: boolean;
  onExit: () => void;
}

/**
 * Fullscreen around the presentation. The page requests fullscreen only if the
 * browser allows it; if the request fails (no user gesture, user refusal, or
 * an unsupported browser) the presentation keeps going windowed.
 */
function enterFullscreen(): void {
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function') return;
  void root.requestFullscreen().catch(() => {
    // Refused or unsupported. Continue windowed.
  });
}

function exitFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement !== root) return;
  if (typeof document.exitFullscreen !== 'function') return;
  void document.exitFullscreen().catch(() => undefined);
}

export function PresentMode({
  board,
  ward,
  baseline,
  title,
  status,
  baselineCapturedAt,
  showNeedsApproval,
  onExit,
}: PresentModeProps): ReactElement {
  useEffect(() => {
    enterFullscreen();
    return () => {
      exitFullscreen();
    };
  }, []);

  return (
    <div
      className="wb-present-surface"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minHeight: '100vh',
        background: 'var(--wb-tv-ground, #10171e)',
      }}
    >
      <Presentation
        board={board}
        ward={ward}
        baseline={baseline}
        title={title}
        status={status}
        baselineCapturedAt={baselineCapturedAt}
        showNeedsApproval={showNeedsApproval}
        onExit={onExit}
      />
    </div>
  );
}
