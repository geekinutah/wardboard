import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportReview, type ImportReplaceHandler } from './ImportReview.tsx';
import type { ImportPreview, ImportResolution } from './plan.ts';
import preview from './preview.tsx';
import type { PreviewData } from '../../preview/types.ts';

const DISCARDED = [
  'Phone',
  'Email',
  'Address',
  'Birth date',
  'Age',
  'Record number',
  'Class rosters',
  'Ministering',
] as const;

function larkPreview(): ImportPreview {
  return {
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
}

function replaceHandler(
  result: Awaited<ReturnType<ImportReplaceHandler>> = { ok: true, matched: 1, created: 1, removed: 0 },
): ImportReplaceHandler {
  return vi.fn<ImportReplaceHandler>(() => Promise.resolve(result));
}

describe('ImportReview', () => {
  it('the review hides the replace action until every identity is resolved', async () => {
    const user = userEvent.setup();
    const onReplace = replaceHandler();
    render(<ImportReview preview={larkPreview()} expectedVersion={3} onReplace={onReplace} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Review before replacing Current' })).toBeInTheDocument();
    expect(screen.getByText('IMPORT · REPLACE CURRENT')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Import steps' });
    expect(within(steps).getByText('1 · Sources')).toBeInTheDocument();
    expect(within(steps).getByRole('listitem', { current: 'step' })).toHaveTextContent('2 · Preview');
    expect(within(steps).getByText('3 · Photos')).toBeInTheDocument();
    expect(within(steps).getByText('4 · Confirm')).toBeInTheDocument();
    expect(within(steps).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs your decision · 2 identities' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'People 2' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Matched positions 12' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Kept positions 4' })).toBeInTheDocument();
    expect(screen.queryByText('[312]')).not.toBeInTheDocument();
    expect(onReplace).not.toHaveBeenCalled();

    const blocked = screen.getByRole('button', { name: 'Resolve 2 identities to continue' });
    expect(blocked).toBeDisabled();
    await user.click(blocked);
    expect(onReplace).not.toHaveBeenCalled();

    const june = screen.getByRole('article', { name: 'Lark, June' });
    await user.click(within(june).getByRole('button', { name: 'June Lark' }));
    expect(within(june).getByRole('button', { name: 'June Lark' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(june).getByRole('button', { name: 'June L. Lark' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('heading', { name: 'Needs your decision · 2 identities' })).toBeInTheDocument();
    const stillBlocked = screen.getByRole('button', { name: 'Resolve 1 identity to continue' });
    expect(stillBlocked).toBeDisabled();

    const otto = screen.getByRole('article', { name: 'Pineda, Otto' });
    await user.click(within(otto).getByRole('button', { name: 'Treat as new person' }));
    expect(within(otto).getByRole('button', { name: 'Treat as new person' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(otto).getByRole('button', { name: 'Otto Pineda' })).toHaveAttribute('aria-pressed', 'false');

    const replace = screen.getByRole('button', { name: 'Replace Current' });
    expect(replace).toBeEnabled();
    await user.click(replace);
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace).toHaveBeenCalledWith({
      expectedVersion: 3,
      resolutions: {
        'lark, june': { action: 'match', memberId: 'm-june' },
        'pineda, otto': { action: 'new' },
      } satisfies Record<string, ImportResolution>,
    });
    expect(await screen.findByText('Replaced Current. Matched 1, created 1, removed 0.')).toBeInTheDocument();
  });

  it('choosing adult or youth is visible on the namesake row', async () => {
    const user = userEvent.setup();
    render(<ImportReview preview={larkPreview()} expectedVersion={3} onReplace={replaceHandler()} />);

    const june = screen.getByRole('article', { name: 'Lark, June' });
    expect(within(june).getByText('Namesakes need a choice. Notes and tags stay with the person you match.')).toBeInTheDocument();
    expect(within(june).queryByRole('button', { name: 'Adult' })).not.toBeInTheDocument();
    expect(within(june).queryByRole('button', { name: 'Youth' })).not.toBeInTheDocument();

    await user.click(within(june).getByRole('button', { name: 'Treat as new person' }));
    expect(within(june).getByRole('button', { name: 'Adult' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(june).getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(june).getByRole('button', { name: 'Youth' }));
    expect(within(june).getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(june).getByRole('button', { name: 'Adult' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(june).getByRole('button', { name: 'Treat as new person' })).toHaveAttribute('aria-pressed', 'true');

    const otto = screen.getByRole('article', { name: 'Pineda, Otto' });
    expect(
      within(otto).getByText('Similar to an existing member. Notes and tags stay only if you match them.'),
    ).toBeInTheDocument();
    await user.click(within(otto).getByRole('button', { name: 'Treat as new person' }));
    expect(within(otto).queryByRole('button', { name: 'Adult' })).not.toBeInTheDocument();
    expect(within(otto).queryByRole('button', { name: 'Youth' })).not.toBeInTheDocument();
  });

  it('discarded fields stay visible as text', () => {
    render(<ImportReview preview={larkPreview()} expectedVersion={3} onReplace={replaceHandler()} />);

    expect(screen.getByRole('heading', { name: 'Discarded before saving' })).toBeInTheDocument();
    expect(screen.getByText('Fields outside the allow-list never reach storage, logs or backups.')).toBeInTheDocument();
    for (const label of DISCARDED) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(
      screen.getByText('Names · youth/adult · callings and positions · vacancies · outside-ward callings'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Proposals keep their own baselines. Notes and tags carry over only for confirmed matches.'),
    ).toBeInTheDocument();
  });

  it('a failed replace does not announce success', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn<ImportReplaceHandler>();
    onReplace.mockResolvedValueOnce({ ok: false, code: 'unresolved' });
    onReplace.mockResolvedValueOnce({ ok: false, code: 'stale', currentVersion: 9 });
    render(<ImportReview preview={larkPreview()} expectedVersion={3} onReplace={onReplace} />);

    const june = screen.getByRole('article', { name: 'Lark, June' });
    const otto = screen.getByRole('article', { name: 'Pineda, Otto' });
    await user.click(within(june).getByRole('button', { name: 'June Lark' }));
    await user.click(within(otto).getByRole('button', { name: 'Treat as new person' }));
    const replace = screen.getByRole('button', { name: 'Replace Current' });
    await user.click(replace);

    expect(await screen.findByRole('alert')).toHaveTextContent('Replace did not run (unresolved).');
    expect(screen.queryByText(/Replaced Current/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current changed. It is now version 9.');
    expect(screen.queryByText(/Replaced Current/)).not.toBeInTheDocument();
  });

  it('no identities leaves replace enabled', async () => {
    const user = userEvent.setup();
    const onReplace = replaceHandler({ ok: true, matched: 1, created: 0, removed: 0 });
    const sample: ImportPreview = {
      decisions: [
        {
          name: 'Kept, Kai',
          key: 'kept, kai',
          category: 'adult',
          sources: ['organizations'],
          externalCallings: [],
          kind: 'matched',
          memberId: 'm-kai',
        },
      ],
      absent: [],
      duplicates: [],
      inconsistentReports: false,
      returning: [],
      needsCategory: [],
      unfamiliar: [],
      keptPositions: 1,
      matchedPositions: 1,
    };

    render(<ImportReview preview={sample} expectedVersion={8} onReplace={onReplace} />);

    expect(screen.getByRole('heading', { name: 'Needs your decision · 0 identities' })).toBeInTheDocument();
    expect(screen.getByText('No identities need a decision.')).toBeInTheDocument();
    const replace = screen.getByRole('button', { name: 'Replace Current' });
    expect(replace).toBeEnabled();
    await user.click(replace);
    expect(onReplace).toHaveBeenCalledWith({ expectedVersion: 8, resolutions: {} });
  });

  it('a blocked preview tells why replace stays off', () => {
    const onReplace = replaceHandler();
    const base = larkPreview();
    const { rerender } = render(
      <ImportReview
        preview={{ ...base, decisions: [], needsCategory: [], duplicates: ['without-callings'] }}
        expectedVersion={3}
        onReplace={onReplace}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This file was already imported. Replace stays off.');
    expect(screen.getByRole('button', { name: 'Replace Current' })).toBeDisabled();
    expect(screen.getByRole('article', { name: 'Members without Callings, Duplicate report' })).toBeInTheDocument();

    rerender(
      <ImportReview
        preview={{ ...base, decisions: [], needsCategory: [], inconsistentReports: true }}
        expectedVersion={3}
        onReplace={onReplace}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('These reports disagree. Replace stays off.');
    expect(screen.getByRole('button', { name: 'Replace Current' })).toBeDisabled();
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('the preview shows the review and does not replace on render', () => {
    render(<>{preview.render({} as PreviewData)}</>);

    expect(screen.getByRole('heading', { name: 'Review before replacing Current' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve 2 identities to continue' })).toBeDisabled();
    expect(screen.getByRole('article', { name: 'Lark, June' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Pineda, Otto' })).toBeInTheDocument();
    expect(screen.queryByText(/Replaced Current/)).not.toBeInTheDocument();
  });
});
