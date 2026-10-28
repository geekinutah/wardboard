import { useState, type ReactElement } from 'react';
import type { PreviewModule } from '../../preview/types.ts';
import { PhotoBatchReview, type PhotoBatchStep } from './PhotoBatchReview.tsx';
import { PhotoUpload } from './PhotoUpload.tsx';
import type { PhotoMember } from './plan.ts';
import './photos.css';

const CAL_REF = `${'ab'.repeat(32)}.jpg`;

function portrait(label: string, background: string, shape: 'circle' | 'square'): string {
  const mark =
    shape === 'circle'
      ? '<circle cx="100" cy="78" r="36" fill="#ffffff"/>'
      : '<rect x="64" y="42" width="72" height="72" rx="8" fill="#ffffff"/>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" fill="${background}"/>${mark}` +
    `<text x="100" y="158" text-anchor="middle" font-size="36" font-family="sans-serif" font-weight="600" fill="#ffffff">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const STEPS: readonly PhotoBatchStep[] = [
  {
    memberName: 'Ada Fictional',
    currentUrl: portrait('AF', '#355C66', 'circle'),
    incomingUrl: portrait('NEW', '#1D5C68', 'square'),
  },
  {
    memberName: 'Ben Example',
    currentUrl: portrait('BE', '#7A5C2E', 'circle'),
    incomingUrl: portrait('IN', '#3F6E4E', 'square'),
  },
];

const CAL: PhotoMember = { id: 'cal-sample', name: 'Cal Sample', photoRef: null };

function PhotosPreview(): ReactElement {
  const [status, setStatus] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [added, setAdded] = useState<readonly string[]>([]);

  function choose(index: number, sentence: (name: string) => string): void {
    const step = STEPS[index];
    if (step === undefined) return;
    setStatus(sentence(step.memberName));
    if (index === STEPS.length - 1) setFinished(true);
  }

  return (
    <div className="wb-photos-preview">
      <PhotoBatchReview
        steps={STEPS}
        sourceLabel="Directory import"
        skippedHousehold={2}
        onKeep={(index) => {
          choose(index, (name) => `Kept the current photo for ${name}.`);
        }}
        onUseNew={(index) => {
          choose(index, (name) => `Using the new photo for ${name}.`);
        }}
        onCancel={() => {
          setStatus('Import cancelled.');
          setFinished(true);
        }}
      />
      {status === null ? null : (
        <p className="wb-photos-status" role="status">
          {status}
        </p>
      )}
      {added.map((line) => (
        <p key={line} className="wb-photos-status">
          {line}
        </p>
      ))}
      {finished ? (
        <PhotoUpload
          member={CAL}
          upload={(file) => {
            if (!(file instanceof File)) return Promise.reject(new Error('expected a file'));
            return Promise.resolve({ photoRef: CAL_REF });
          }}
          assign={() => {
            setAdded((lines) => [...lines, 'Photo added for Cal Sample']);
            return Promise.resolve();
          }}
        />
      ) : null}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Photo comparison',
  render: () => <PhotosPreview />,
};

export default preview;
