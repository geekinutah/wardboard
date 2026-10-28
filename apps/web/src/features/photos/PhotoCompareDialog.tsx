import { useId, type ReactElement } from 'react';
import { Button } from '../../design/Button.tsx';
import { avatarColor, initials } from '../../design/person.ts';
import './photos.css';

export type PhotoCompareDialogProps = {
  readonly memberName: string;
  readonly currentUrl: string | null;
  readonly incomingUrl: string;
  readonly sourceLabel: string;
  readonly index: number;
  readonly total: number;
  readonly skippedHousehold: number;
  readonly onKeepCurrent: () => void;
  readonly onUseNew: () => void;
  readonly onCancelImport: () => void;
};

function householdSentence(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 household image was skipped — it isn't offered as a portrait.";
  return `${String(count)} household images were skipped — they aren't offered as portraits.`;
}

export function PhotoCompareDialog({
  memberName,
  currentUrl,
  incomingUrl,
  sourceLabel,
  index,
  total,
  skippedHousehold,
  onKeepCurrent,
  onUseNew,
  onCancelImport,
}: PhotoCompareDialogProps): ReactElement {
  const titleId = useId();
  const currentAlt = `Current portrait of ${memberName}`;
  const incomingAlt = `Incoming portrait of ${memberName}`;
  const skipped = householdSentence(skippedHousehold);
  const width = total <= 0 ? 0 : Math.round((Math.min(index, total) / total) * 100);

  return (
    <div className="wb-photo-compare-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="wb-photo-compare-dialog">
        <div className="wb-photo-compare-heading">
          <h2 id={titleId} className="wb-photo-compare-title">{`Replace ${memberName}'s photo?`}</h2>
          <p className="wb-photo-compare-step">{`${sourceLabel} · ${String(index)} of ${String(total)}`}</p>
        </div>
        <div
          className="wb-photo-compare-progress"
          role="progressbar"
          aria-valuenow={index}
          aria-valuemin={1}
          aria-valuemax={total}
        >
          <span className="wb-photo-compare-progress-fill" style={{ width: `${String(width)}%` }} />
        </div>
        <div className="wb-photo-compare-figures">
          <figure className="wb-photo-compare-figure">
            <span className="wb-photo-compare-kicker">CURRENT</span>
            {currentUrl === null ? (
              <div
                role="img"
                aria-label={currentAlt}
                className="wb-photo-compare-placeholder"
                style={{ background: avatarColor(memberName) }}
              >
                {initials(memberName)}
              </div>
            ) : (
              <img className="wb-photo-compare-portrait" alt={currentAlt} src={currentUrl} />
            )}
            <figcaption className="wb-photo-compare-caption">Current portrait</figcaption>
          </figure>
          <figure className="wb-photo-compare-figure wb-photo-compare-figure-incoming">
            <span className="wb-photo-compare-kicker wb-photo-compare-kicker-incoming">INCOMING</span>
            <img className="wb-photo-compare-portrait" alt={incomingAlt} src={incomingUrl} />
            <figcaption className="wb-photo-compare-caption">Incoming portrait</figcaption>
          </figure>
        </div>
        {skipped === null ? null : <p className="wb-photo-compare-skipped">{skipped}</p>}
        <div className="wb-photo-compare-actions">
          <Button variant="ghost" onClick={onCancelImport}>
            Cancel import
          </Button>
          <div className="wb-photo-compare-actions-main">
            <Button variant="secondary" onClick={onKeepCurrent}>
              Keep Current
            </Button>
            <Button variant="primary" onClick={onUseNew}>
              Use New Photo
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
