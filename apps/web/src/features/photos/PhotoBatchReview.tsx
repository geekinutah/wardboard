import { useState, type ReactElement } from 'react';
import { PhotoCompareDialog } from './PhotoCompareDialog.tsx';

export type PhotoBatchStep = {
  readonly memberName: string;
  readonly currentUrl: string | null;
  readonly incomingUrl: string;
};

export type PhotoBatchReviewProps = {
  readonly steps: readonly PhotoBatchStep[];
  readonly sourceLabel: string;
  readonly skippedHousehold: number;
  readonly onUseNew: (index: number) => void;
  readonly onKeep: (index: number) => void;
  readonly onCancel: () => void;
};

export function PhotoBatchReview({
  steps,
  sourceLabel,
  skippedHousehold,
  onUseNew,
  onKeep,
  onCancel,
}: PhotoBatchReviewProps): ReactElement {
  const [cursor, setCursor] = useState(0);
  const [outcome, setOutcome] = useState<string | null>(null);
  const step = steps[cursor];

  if (outcome !== null || step === undefined) {
    return <p className="wb-photo-batch-result">{outcome ?? ''}</p>;
  }

  const current = step;
  const last = cursor >= steps.length - 1;

  return (
    <PhotoCompareDialog
      memberName={current.memberName}
      currentUrl={current.currentUrl}
      incomingUrl={current.incomingUrl}
      sourceLabel={sourceLabel}
      index={cursor + 1}
      total={steps.length}
      skippedHousehold={skippedHousehold}
      onKeepCurrent={() => {
        onKeep(cursor);
        if (last) {
          setOutcome(`Kept the current photo for ${current.memberName}.`);
          return;
        }
        setCursor(cursor + 1);
      }}
      onUseNew={() => {
        onUseNew(cursor);
        if (last) {
          setOutcome(`Using the new photo for ${current.memberName}.`);
          return;
        }
        setCursor(cursor + 1);
      }}
      onCancelImport={() => {
        onCancel();
        setOutcome('Import cancelled.');
      }}
    />
  );
}
