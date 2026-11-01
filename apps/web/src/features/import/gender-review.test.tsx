import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportReview, type ImportReplaceHandler } from './ImportReview.tsx';
import type { ImportPreview, PersonDecision } from './plan.ts';

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

const KEPT = 'Names · youth/adult · gender · callings and positions · vacancies · outside-ward callings';

function person(name: string, key: string, category: 'adult' | 'youth' | null = null): PersonDecision {
  return {
    name,
    key,
    category,
    sources: ['organizations'],
    externalCallings: [],
    kind: 'new',
  };
}

function previewOf(
  decisions: readonly PersonDecision[],
  needsCategory: readonly string[],
  needsGender: readonly string[] = [],
): ImportPreview {
  return {
    decisions,
    absent: [],
    duplicates: [],
    inconsistentReports: false,
    returning: [],
    needsCategory,
    needsGender,
    unfamiliar: [],
    keptPositions: 0,
    matchedPositions: 0,
  };
}

function replaceHandler(): ImportReplaceHandler {
  return vi.fn<ImportReplaceHandler>(() => Promise.resolve({ ok: true, matched: 0, created: 1, removed: 0 }));
}

describe('import gender review', () => {
  it('import review lists Gender under Kept and not Discarded', () => {
    render(
      <ImportReview
        preview={previewOf([person('Kept, Kai', 'kept, kai', 'adult')], [])}
        expectedVersion={1}
        onReplace={replaceHandler()}
      />,
    );

    expect(screen.getByText(KEPT)).toBeInTheDocument();
    for (const label of DISCARDED) {
      expect(screen.getByText(label)).toBeVisible();
      expect(label).not.toMatch(/^gender$/i);
    }
    expect(screen.queryByText('Gender')).not.toBeInTheDocument();
  });

  it('import review requires choosing Male or Female when a new member has null gender', async () => {
    const user = userEvent.setup();
    const onReplace = replaceHandler();
    render(
      <ImportReview
        preview={previewOf(
          [person('Westdale, Gus', 'westdale, gus'), person('Fairwell, Sage', 'fairwell, sage')],
          ['westdale, gus', 'fairwell, sage'],
          ['westdale, gus', 'fairwell, sage'],
        )}
        expectedVersion={2}
        onReplace={onReplace}
      />,
    );

    const gus = screen.getByRole('article', { name: 'Westdale, Gus' });
    const sage = screen.getByRole('article', { name: 'Fairwell, Sage' });
    expect(within(gus).getByRole('group', { name: 'Gender for Westdale, Gus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve 2 identities to continue' })).toBeDisabled();

    await user.click(within(gus).getByRole('button', { name: 'Adult' }));
    expect(screen.getByRole('button', { name: 'Resolve 2 identities to continue' })).toBeDisabled();
    expect(onReplace).not.toHaveBeenCalled();

    await user.click(within(within(gus).getByRole('group', { name: 'Gender for Westdale, Gus' })).getByRole('button', { name: 'Male' }));
    expect(screen.getByRole('button', { name: 'Resolve 1 identity to continue' })).toBeDisabled();

    await user.click(within(within(sage).getByRole('group', { name: 'Gender for Fairwell, Sage' })).getByRole('button', { name: 'Female' }));
    expect(screen.getByRole('button', { name: 'Resolve 1 identity to continue' })).toBeDisabled();
    await user.click(within(sage).getByRole('button', { name: 'Youth' }));

    const replace = screen.getByRole('button', { name: 'Replace Current' });
    expect(replace).toBeEnabled();
    await user.click(replace);
    expect(onReplace).toHaveBeenCalledWith({
      expectedVersion: 2,
      resolutions: {
        'westdale, gus': { action: 'new', category: 'adult', gender: 'M' },
        'fairwell, sage': { action: 'new', category: 'youth', gender: 'F' },
      },
    });
  });

  it('a category-only new row skips gender, and a gender-only new row skips adult or youth', async () => {
    const user = userEvent.setup();
    const onReplace = replaceHandler();
    render(
      <ImportReview
        preview={previewOf(
          [person('Category, Cora', 'category, cora'), person('Gender, Glen', 'gender, glen', 'adult')],
          ['category, cora'],
          ['gender, glen'],
        )}
        expectedVersion={4}
        onReplace={onReplace}
      />,
    );

    const cora = screen.getByRole('article', { name: 'Category, Cora' });
    expect(within(cora).getByRole('button', { name: 'Adult' })).toBeInTheDocument();
    expect(within(cora).getByRole('button', { name: 'Youth' })).toBeInTheDocument();
    expect(within(cora).queryByRole('group', { name: 'Gender for Category, Cora' })).not.toBeInTheDocument();
    expect(within(cora).queryByRole('button', { name: 'Male' })).not.toBeInTheDocument();
    expect(within(cora).queryByRole('button', { name: 'Female' })).not.toBeInTheDocument();

    const glen = screen.getByRole('article', { name: 'Gender, Glen' });
    expect(within(glen).queryByRole('button', { name: 'Adult' })).not.toBeInTheDocument();
    expect(within(glen).queryByRole('button', { name: 'Youth' })).not.toBeInTheDocument();
    expect(within(glen).getByRole('group', { name: 'Gender for Gender, Glen' })).toBeInTheDocument();
    expect(within(glen).getByText('Not in WardBoard yet. Choose male or female.')).toBeInTheDocument();

    await user.click(within(cora).getByRole('button', { name: 'Youth' }));
    expect(screen.getByRole('button', { name: 'Resolve 1 identity to continue' })).toBeDisabled();
    await user.click(within(glen).getByRole('button', { name: 'Female' }));

    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    expect(onReplace).toHaveBeenCalledWith({
      expectedVersion: 4,
      resolutions: {
        'category, cora': { action: 'new', category: 'youth' },
        'gender, glen': { action: 'new', gender: 'F' },
      },
    });
  });
});
