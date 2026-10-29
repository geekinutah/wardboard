import type { ReactElement } from 'react';
import type { PreviewModule } from '../../preview/types.ts';
import { ImportReview, type ImportReplaceHandler } from './ImportReview.tsx';
import type { ImportPreview } from './plan.ts';

const PREVIEW: ImportPreview = {
  decisions: [
    {
      name: 'Lark, June',
      key: 'lark, june',
      category: null,
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'namesake',
      candidates: [
        { memberId: 'm-june', name: 'June Lark' },
        { memberId: 'm-junel', name: 'June L. Lark' },
      ],
    },
    {
      name: 'Pineda, Otto',
      key: 'pineda, otto',
      category: 'adult',
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'resembles',
      candidates: [{ memberId: 'm-otto', name: 'Otto Pineda' }],
    },
  ],
  absent: [],
  duplicates: [],
  inconsistentReports: false,
  returning: [],
  needsCategory: ['lark, june'],
  unfamiliar: [],
  keptPositions: 4,
  matchedPositions: 12,
};

const recordReplace: ImportReplaceHandler = () => Promise.resolve({ ok: true, matched: 1, created: 1, removed: 0 });

function ImportPreviewScreen(): ReactElement {
  return <ImportReview preview={PREVIEW} expectedVersion={3} onReplace={recordReplace} />;
}

const preview: PreviewModule = {
  title: 'Import preview',
  render: () => <ImportPreviewScreen />,
};

export default preview;
