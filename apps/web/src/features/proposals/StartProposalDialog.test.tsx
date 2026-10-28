import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  StartProposalDialog,
  type CreateProposalRequest,
  type CreateProposalResult,
  type StartProposalChoice,
  type StartProposalDialogProps,
} from './StartProposalDialog.tsx';

const IMPORTED_AT = '2026-10-24T15:00:00.000Z';

const spring: StartProposalChoice = {
  id: 'p-spring',
  name: 'Spring adjustments',
  status: 'draft',
  tabOrder: 1,
};

const youth: StartProposalChoice = {
  id: 'p-youth',
  name: 'Youth focus',
  status: 'accepted',
  tabOrder: 2,
};

function renderDialog(
  overrides: Partial<StartProposalDialogProps> = {},
): {
  onCreate: StartProposalDialogProps['onCreate'];
  onClose: () => void;
} {
  const onCreate =
    overrides.onCreate ??
    vi.fn<(request: CreateProposalRequest) => Promise<CreateProposalResult>>(() =>
      Promise.resolve({ ok: true }),
    );
  const onClose = overrides.onClose ?? vi.fn();
  const props: StartProposalDialogProps = {
    importedAt: overrides.importedAt ?? IMPORTED_AT,
    proposals: overrides.proposals ?? [youth, spring],
    onCreate,
    onClose,
    ...(overrides.initialSource !== undefined ? { initialSource: overrides.initialSource } : {}),
  };
  render(<StartProposalDialog {...props} />);
  return { onCreate, onClose };
}

describe('StartProposalDialog', () => {
  it('Current is checked by default and its detail names the import date', () => {
    renderDialog({ proposals: [spring, youth] });

    const dialog = screen.getByRole('dialog', { name: 'Start a proposal' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Start a proposal' })).toBeInTheDocument();

    const current = screen.getByRole('radio', { name: 'Current' });
    expect(current).toBeChecked();
    expect(current).toHaveAccessibleDescription("Baseline is today's Current (Oct 24, 2026 import)");
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Rationale (optional)' })).toHaveValue('');
  });

  it('lists proposals in tabOrder with Accepted marked', () => {
    renderDialog({ proposals: [youth, spring] });

    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName('Current');
    expect(radios[1]).toHaveAccessibleName('Duplicate “Spring adjustments”');
    expect(radios[2]).toHaveAccessibleName('Duplicate “Youth focus”');
    expect(radios[1]).toHaveAccessibleDescription('Copies its arrangement; keeps its original baseline');
    expect(radios[2]).toHaveAccessibleDescription(
      'Copies its arrangement; keeps its original baseline · Accepted',
    );
  });

  it('no proposals shows only Current', () => {
    renderDialog({ proposals: [] });

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(1);
    expect(radios[0]).toHaveAccessibleName('Current');
    expect(radios[0]).toBeChecked();
  });

  it('initialSource selects a duplicate; an unknown id falls back to Current', () => {
    renderDialog({
      proposals: [spring, youth],
      initialSource: { kind: 'proposal', proposalId: spring.id },
    });
    expect(screen.getByRole('radio', { name: 'Duplicate “Spring adjustments”' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Current' })).not.toBeChecked();

    cleanup();

    renderDialog({
      proposals: [spring, youth],
      initialSource: { kind: 'proposal', proposalId: 'missing' },
    });
    const checked = screen.getAllByRole('radio').filter((radio) => radio instanceof HTMLInputElement && radio.checked);
    expect(checked).toHaveLength(1);
    const only = checked[0];
    if (only === undefined) {
      throw new Error('expected one checked radio');
    }
    expect(only).toHaveAccessibleName('Current');
  });

  it('creates from Current with a trimmed name and null rationale', async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = renderDialog({ proposals: [spring, youth] });

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Fall plan  ');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Fall plan',
      rationale: null,
      source: { kind: 'current' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a duplicate with the chosen proposal id and rationale', async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = renderDialog({ proposals: [youth, spring] });

    await user.click(screen.getByRole('radio', { name: 'Duplicate “Spring adjustments”' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Fall plan  ');
    await user.type(screen.getByRole('textbox', { name: 'Rationale (optional)' }), '  More teachers  ');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Fall plan',
      rationale: 'More teachers',
      source: { kind: 'proposal', proposalId: spring.id },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blank name disables Create', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();
    const create = screen.getByRole('button', { name: 'Create proposal' });
    expect(create).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ');
    expect(create).toBeDisabled();
    expect(screen.queryByText('Name must be 80 characters or fewer.')).not.toBeInTheDocument();
    expect(screen.queryByText('Rationale must be 500 characters or fewer.')).not.toBeInTheDocument();

    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('name 80 allowed, 81 refused; rationale 500 allowed, 501 refused', () => {
    const emoji = '😀';
    expect(Array.from(emoji).length).toBe(1);
    expect(emoji.length).toBe(2);

    renderDialog();
    const name = screen.getByRole('textbox', { name: 'Name' });
    const rationale = screen.getByRole('textbox', { name: 'Rationale (optional)' });
    const name80 = emoji.repeat(80);
    const name81 = emoji.repeat(81);
    expect(Array.from(name80).length).toBe(80);
    expect(name80.length).toBe(160);

    fireEvent.change(name, { target: { value: name80 } });
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeEnabled();
    expect(screen.queryByText('Name must be 80 characters or fewer.')).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: name81 } });
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeDisabled();
    expect(screen.getByText('Name must be 80 characters or fewer.')).toBeInTheDocument();

    fireEvent.change(name, { target: { value: 'Primary staffing' } });
    fireEvent.change(rationale, { target: { value: emoji.repeat(500) } });
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeEnabled();
    expect(screen.queryByText('Rationale must be 500 characters or fewer.')).not.toBeInTheDocument();
    expect(screen.queryByText('Name must be 80 characters or fewer.')).not.toBeInTheDocument();

    fireEvent.change(rationale, { target: { value: emoji.repeat(501) } });
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeDisabled();
    expect(screen.getByText('Rationale must be 500 characters or fewer.')).toBeInTheDocument();
  });

  it('double click and Enter while pending call onCreate once and show Creating…', async () => {
    const user = userEvent.setup();
    let resolveCreate: (result: CreateProposalResult) => void = () => {
      throw new Error('resolveCreate not ready');
    };
    const onCreate = vi.fn<(request: CreateProposalRequest) => Promise<CreateProposalResult>>(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const onClose = vi.fn();
    renderDialog({ onCreate, onClose });

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Fall plan');
    const create = screen.getByRole('button', { name: 'Create proposal' });
    await user.click(create);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Fall plan',
      rationale: null,
      source: { kind: 'current' },
    });
    const pending = screen.getByRole('button', { name: 'Creating…' });
    expect(pending).toBeDisabled();

    fireEvent.click(pending);
    const form = pending.closest('form');
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('form missing');
    }
    fireEvent.submit(form);
    screen.getByRole('textbox', { name: 'Name' }).focus();
    await user.keyboard('{Enter}');

    expect(onCreate).toHaveBeenCalledTimes(1);
    resolveCreate({ ok: true });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('failure shows the message and keeps the inputs', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn<(request: CreateProposalRequest) => Promise<CreateProposalResult>>(() =>
      Promise.resolve({ ok: false, message: 'offline' }),
    );
    const onClose = vi.fn();
    renderDialog({ onCreate, onClose, proposals: [spring, youth] });

    await user.click(screen.getByRole('radio', { name: 'Duplicate “Spring adjustments”' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    const rationale = screen.getByRole('textbox', { name: 'Rationale (optional)' });
    await user.type(name, 'Fall plan');
    await user.type(rationale, 'Because');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not create the proposal: offline');
    });
    expect(name).toHaveValue('Fall plan');
    expect(rationale).toHaveValue('Because');
    expect(screen.getByRole('radio', { name: 'Duplicate “Spring adjustments”' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close without creating', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn<(request: CreateProposalRequest) => Promise<CreateProposalResult>>(() =>
      Promise.resolve({ ok: true }),
    );
    const onClose = vi.fn();
    const { unmount } = render(
      <StartProposalDialog
        importedAt={IMPORTED_AT}
        proposals={[spring, youth]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();

    unmount();
    onClose.mockClear();
    render(
      <StartProposalDialog
        importedAt={IMPORTED_AT}
        proposals={[spring, youth]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
