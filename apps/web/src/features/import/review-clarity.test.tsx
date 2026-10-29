import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportReview, type ImportReplaceHandler } from './ImportReview.tsx';
import { planImportReview, type ImportPreview, type PersonDecision } from './plan.ts';

function newPerson(name: string): PersonDecision {
  return {
    name,
    key: name.toLowerCase(),
    category: null,
    sources: ['organizations'],
    externalCallings: [],
    kind: 'new',
  };
}

function previewOf(decisions: PersonDecision[], unfamiliar = 0): ImportPreview {
  return {
    decisions,
    absent: [],
    duplicates: [],
    inconsistentReports: false,
    returning: [],
    needsCategory: decisions.filter((d) => d.kind === 'new').map((d) => d.key),
    unfamiliar: Array.from({ length: unfamiliar }, (_, index) => ({
      organization: 'Elders Quorum',
      group: 'Presidency',
      title: `Calling ${String(index)}`,
      vacant: false,
    })),
    keptPositions: 0,
    matchedPositions: 0,
  };
}

const THREE = (): ImportPreview =>
  previewOf([newPerson('Alder, Ann'), newPerson('Birch, Bo'), newPerson('Cedar, Cy')]);

function handler(): ImportReplaceHandler {
  return vi.fn<ImportReplaceHandler>(() => Promise.resolve({ ok: true, matched: 0, created: 3, removed: 0 }));
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole('article', { name });
}

describe('import review clarity', () => {
  it('a row without match options asks only Adult or Youth', async () => {
    const user = userEvent.setup();
    const onReplace = handler();
    render(<ImportReview preview={previewOf([newPerson('Alder, Ann')])} expectedVersion={0} onReplace={onReplace} />);
    const row = rowOf('Alder, Ann');
    expect(within(row).queryByRole('button', { name: 'Treat as new person' })).not.toBeInTheDocument();
    expect(within(row).getByText('Not in WardBoard yet. Choose adult or youth.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Adult' })).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Youth' }));
    expect(within(row).getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    expect(onReplace).toHaveBeenCalledWith({
      expectedVersion: 0,
      resolutions: { 'alder, ann': { action: 'new', category: 'youth' } },
    });
  });

  it('a report conflict keeps its explanation', () => {
    const conflict: PersonDecision = {
      name: 'Conflict, Cam',
      key: 'conflict, cam',
      category: null,
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'report_conflict',
      candidates: [],
    };
    render(<ImportReview preview={previewOf([conflict])} expectedVersion={0} onReplace={handler()} />);
    const row = rowOf('Conflict, Cam');
    expect(
      within(row).getByText('The reports disagree about this person. They cannot be matched to an existing member.'),
    ).toBeInTheDocument();
    expect(within(row).queryByText('Not in WardBoard yet. Choose adult or youth.')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Treat as new person' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Adult' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Youth' })).toBeInTheDocument();
  });

  it('a row with match options keeps Treat as new person', () => {
    const namesake: PersonDecision = {
      name: 'Lark, June',
      key: 'lark, june',
      category: 'adult',
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'namesake',
      candidates: [{ memberId: 'm-june', name: 'June Lark' }],
    };
    render(<ImportReview preview={previewOf([namesake])} expectedVersion={3} onReplace={handler()} />);
    const row = rowOf('Lark, June');
    expect(within(row).getByRole('button', { name: 'June Lark' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Treat as new person' })).toBeInTheDocument();
  });

  it('first import labels callings New callings', () => {
    const sample = previewOf([], 4);
    const { rerender } = render(<ImportReview preview={sample} expectedVersion={0} onReplace={handler()} />);
    expect(screen.getByRole('article', { name: 'New callings 4' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Unfamiliar callings/ })).not.toBeInTheDocument();
    rerender(<ImportReview preview={sample} expectedVersion={3} onReplace={handler()} />);
    expect(screen.getByRole('article', { name: 'Unfamiliar callings 4' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /New callings/ })).not.toBeInTheDocument();
  });

  it('planImportReview defaults firstImport to false', () => {
    const sample = previewOf([], 2);
    expect(planImportReview(sample).stats.at(-1)).toEqual({ label: 'Unfamiliar callings', value: 2 });
    expect(planImportReview(sample, true).stats.at(-1)).toEqual({ label: 'New callings', value: 2 });
  });

  it('unresolved rows say Needs a choice', async () => {
    const user = userEvent.setup();
    render(<ImportReview preview={THREE()} expectedVersion={0} onReplace={handler()} />);
    const ann = rowOf('Alder, Ann');
    expect(within(ann).getByText('Needs a choice')).toBeInTheDocument();
    expect(ann).toHaveAccessibleDescription(/Needs a choice/);
    await user.click(within(ann).getByRole('button', { name: 'Adult' }));
    expect(within(ann).queryByText('Needs a choice')).not.toBeInTheDocument();
    expect(ann).not.toHaveAccessibleDescription(/Needs a choice/);
    expect(within(rowOf('Birch, Bo')).getByText('Needs a choice')).toBeInTheDocument();
  });

  it('Go to next names and focuses the first unresolved row', async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<ImportReview preview={THREE()} expectedVersion={0} onReplace={handler()} />);
    await user.click(within(rowOf('Birch, Bo')).getByRole('button', { name: 'Adult' }));
    const next = screen.getByRole('button', { name: 'Go to next: Alder, Ann' });
    await user.click(next);
    expect(rowOf('Alder, Ann')).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    await user.click(within(rowOf('Alder, Ann')).getByRole('button', { name: 'Youth' }));
    expect(screen.queryByRole('button', { name: 'Go to next: Alder, Ann' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to next: Cedar, Cy' }));
    expect(rowOf('Cedar, Cy')).toHaveFocus();
    await user.click(within(rowOf('Cedar, Cy')).getByRole('button', { name: 'Adult' }));
    expect(screen.queryByRole('button', { name: /Go to next/ })).not.toBeInTheDocument();
  });

  it('the count line tracks unresolved rows', async () => {
    const user = userEvent.setup();
    render(<ImportReview preview={THREE()} expectedVersion={0} onReplace={handler()} />);
    const line = screen.getByText('3 of 3 need a choice');
    expect(line).toHaveAttribute('aria-live', 'polite');
    await user.click(within(rowOf('Alder, Ann')).getByRole('button', { name: 'Adult' }));
    expect(screen.getByText('2 of 3 need a choice')).toBeInTheDocument();
    await user.click(within(rowOf('Birch, Bo')).getByRole('button', { name: 'Adult' }));
    expect(screen.getByText('1 of 3 need a choice')).toBeInTheDocument();
    await user.click(within(rowOf('Cedar, Cy')).getByRole('button', { name: 'Adult' }));
    expect(screen.queryByText(/need a choice/)).not.toBeInTheDocument();
  });
});
