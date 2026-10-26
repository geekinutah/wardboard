import type { ReactElement } from 'react';
import { cx } from './cx.ts';
import './components.css';

export type VacancySlotProps = {
  title?: string | undefined;
  className?: string | undefined;
};

export function VacancySlot({ title, className }: VacancySlotProps): ReactElement {
  const label = title === undefined ? '' : title.trim();
  const accessibleName = label.length === 0 ? 'Vacant' : `Vacant, ${label}`;
  return (
    <article aria-label={accessibleName} className={cx('wb-vacancy', className)}>
      {label.length > 0 ? <span className="wb-section-label">{label}</span> : null}
      <div className="wb-vacancy-body">
        <span className="wb-vacancy-circle" aria-hidden="true" />
        <span className="wb-vacancy-label">Vacant</span>
      </div>
    </article>
  );
}
