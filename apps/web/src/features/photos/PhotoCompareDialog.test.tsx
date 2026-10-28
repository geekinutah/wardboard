import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoCompareDialog, type PhotoCompareDialogProps } from './PhotoCompareDialog.tsx';

const HOUSEHOLD_ONE = "1 household image was skipped — it isn't offered as a portrait.";
const HOUSEHOLD_TWO = "2 household images were skipped — they aren't offered as portraits.";

function renderDialog(overrides: Partial<PhotoCompareDialogProps> = {}) {
  const props: PhotoCompareDialogProps = {
    memberName: 'Ada Fictional',
    currentUrl: 'data:image/svg+xml,current',
    incomingUrl: 'data:image/svg+xml,incoming',
    sourceLabel: 'Directory import',
    index: 1,
    total: 2,
    skippedHousehold: 2,
    onKeepCurrent: vi.fn(),
    onUseNew: vi.fn(),
    onCancelImport: vi.fn(),
    ...overrides,
  };
  const view = render(<PhotoCompareDialog {...props} />);
  return { ...view, props };
}

describe('PhotoCompareDialog', () => {
  it('dialog names the member and the step', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: "Replace Ada Fictional's photo?" })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: "Replace Ada Fictional's photo?" })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getByText('Directory import · 1 of 2')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemin', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.getByText('INCOMING')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Current portrait of Ada Fictional' })).toHaveAttribute(
      'src',
      'data:image/svg+xml,current',
    );
    expect(screen.getByRole('img', { name: 'Incoming portrait of Ada Fictional' })).toHaveAttribute(
      'src',
      'data:image/svg+xml,incoming',
    );
    expect(screen.getByText('Current portrait')).toBeInTheDocument();
    expect(screen.getByText('Incoming portrait')).toBeInTheDocument();
    expect(screen.getByText(HOUSEHOLD_TWO)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep Current' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use New Photo' })).toBeInTheDocument();
  });

  it('no household sentence when none were skipped', () => {
    renderDialog({ skippedHousehold: 0 });
    expect(screen.queryByText(/household image/i)).not.toBeInTheDocument();
  });

  it('singular household sentence', () => {
    renderDialog({ skippedHousehold: 1 });
    expect(screen.getByText(HOUSEHOLD_ONE)).toBeInTheDocument();
    expect(screen.queryByText(/images were skipped/)).not.toBeInTheDocument();
  });

  it('keep, use, and cancel call only their own handler', async () => {
    const user = userEvent.setup();
    const cases = [
      ['Keep Current', 'onKeepCurrent'],
      ['Use New Photo', 'onUseNew'],
      ['Cancel import', 'onCancelImport'],
    ] as const;

    for (const [label, key] of cases) {
      const onKeepCurrent = vi.fn();
      const onUseNew = vi.fn();
      const onCancelImport = vi.fn();
      const handlers = { onKeepCurrent, onUseNew, onCancelImport };
      const view = renderDialog(handlers);
      await user.click(screen.getByRole('button', { name: label }));
      expect(handlers[key]).toHaveBeenCalledTimes(1);
      for (const [name, handler] of Object.entries(handlers)) {
        if (name !== key) expect(handler).not.toHaveBeenCalled();
      }
      view.unmount();
    }
  });
});
