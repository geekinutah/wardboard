import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Member, Ward } from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { NotesDialog, type NotesDialogProps } from './NotesDialog.tsx';

const JAY_NOTE = 'Travels for work most weekdays in March.';

function memberByName(ward: Ward, name: string): Member {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`member ${name} not found`);
  }
  return found;
}

function jayStorybook(): Member {
  const { ward } = buildFixtureWard();
  const jay = memberByName(ward, 'Jay Storybook');
  if (jay.note !== JAY_NOTE) {
    throw new Error('Jay Storybook note fixture changed');
  }
  return jay;
}

function renderDialog(overrides: Partial<NotesDialogProps> = {}) {
  const jay = overrides.member ?? jayStorybook();
  const onSave = overrides.onSave ?? vi.fn<NotesDialogProps['onSave']>(() => Promise.resolve({ ok: true }));
  const onClose = overrides.onClose ?? vi.fn();
  const view = render(<NotesDialog member={jay} onSave={onSave} onClose={onClose} />);
  return { ...view, jay, onSave, onClose };
}

describe('NotesDialog', () => {
  it("opens with the existing note, focused, under the member's name", () => {
    renderDialog();
    const field = screen.getByRole('textbox', { name: 'Note' });
    expect(field).toHaveValue(JAY_NOTE);
    expect(field).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Notes · Jay Storybook' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Notes · Jay Storybook' })).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByText('Notes are shared across Current and every proposal. They never appear on the TV or in search.'),
    ).toBeInTheDocument();
    expect(screen.getByText(`${String(Array.from(JAY_NOTE).length)} / 280`)).toBeInTheDocument();
  });

  it('saves the trimmed note once, then closes', async () => {
    const user = userEvent.setup();
    let resolveSave: (value: { ok: true }) => void = () => {
      throw new Error('save was not started');
    };
    const onSave = vi.fn<NotesDialogProps['onSave']>(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onClose = vi.fn();
    const { jay } = renderDialog({ onSave, onClose });
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    await user.type(field, '  Prefers mornings  ');
    expect(field).toHaveValue('  Prefers mornings  ');

    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    await user.click(save);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(jay.id, 'Prefers mornings');
    expect(onClose).not.toHaveBeenCalled();

    resolveSave({ ok: true });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('clearing the note saves null', async () => {
    const user = userEvent.setup();
    const { jay, onSave, onClose } = renderDialog();
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    expect(field).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(jay.id, null);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('Save is disabled when unchanged', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('281 characters disables Save and shows the limit message; 280 is allowed', () => {
    const emoji = '😀';
    const allowed = `${'a'.repeat(279)}${emoji}`;
    const tooLong = `${'a'.repeat(280)}${emoji}`;
    expect(Array.from(emoji)).toHaveLength(1);
    expect(emoji.length).toBeGreaterThan(1);
    expect(Array.from(allowed)).toHaveLength(280);
    expect(allowed.length).toBeGreaterThan(280);
    expect(Array.from(tooLong)).toHaveLength(281);
    expect(tooLong.length).toBeGreaterThan(281);

    renderDialog();
    const field = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(field, { target: { value: tooLong } });
    expect(screen.getByText('281 / 280')).toBeInTheDocument();
    expect(screen.getByText('Notes can be at most 280 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(field, { target: { value: allowed } });
    expect(screen.getByText('280 / 280')).toBeInTheDocument();
    expect(screen.queryByText('Notes can be at most 280 characters.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('a failed save shows the message and keeps the text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<NotesDialogProps['onSave']>(() => Promise.resolve({ ok: false, message: 'offline' }));
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    await user.type(field, '  still here  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the note: offline');
    expect(field).toHaveValue('  still here  ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(jayStorybook().id, 'still here');
  });

  it('Cancel and Escape close without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<NotesDialogProps['onSave']>(() => Promise.resolve({ ok: true }));
    const onClose = vi.fn();
    const { unmount } = renderDialog({ onSave, onClose });
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.type(field, ' extra');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    unmount();

    onClose.mockClear();
    renderDialog({ onSave, onClose });
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'x');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
