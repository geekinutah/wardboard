import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx.ts';
import './components.css';

export type ChipVariant = 'tag' | 'proposed' | 'release' | 'needs-approval' | 'vacancy';

export type ChipProps = {
  label: string;
  variant?: ChipVariant | undefined;
  className?: string | undefined;
};

function LockIcon(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function Chip({ label, variant = 'tag', className }: ChipProps): ReactElement {
  const icon: ReactNode = variant === 'needs-approval' ? <LockIcon /> : null;
  return (
    <span className={cx('wb-chip', `wb-chip-${variant}`, className)}>
      {icon}
      {label}
    </span>
  );
}
