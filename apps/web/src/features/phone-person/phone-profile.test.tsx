import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { avatarColor, initials } from '../../design/person.ts';
import { PhoneProfileSheet, type PhoneProfileMember, type PhoneProfileSheetProps } from './PhoneProfileSheet.tsx';

const REF = 'new-ref.png';

function member(overrides: Partial<PhoneProfileMember> = {}): PhoneProfileMember {
  return {
    id: 'm-nia',
    name: 'Nia Sample',
    photoRef: null,
    note: null,
    category: 'adult',
    ...overrides,
  };
}

function renderSheet(overrides: Partial<PhoneProfileSheetProps> = {}) {
  const person = overrides.member ?? member();
  const onSaveNote = vi.fn<PhoneProfileSheetProps['onSaveNote']>(overrides.onSaveNote ?? (() => Promise.resolve({ ok: true })));
  const upload = vi.fn<PhoneProfileSheetProps['upload']>(overrides.upload ?? (() => Promise.resolve({ photoRef: REF })));
  const assign = vi.fn<PhoneProfileSheetProps['assign']>(overrides.assign ?? (() => Promise.resolve()));
  const onClose = overrides.onClose ?? vi.fn();
  const currentUrl = overrides.currentUrl === undefined ? (person.photoRef === null ? null : '/api/photos/nia.png') : overrides.currentUrl;
  const view = render(
    <PhoneProfileSheet
      member={person}
      currentUrl={currentUrl}
      onSaveNote={onSaveNote}
      upload={upload}
      assign={assign}
      onClose={onClose}
    />,
  );
  return { ...view, person, onSaveNote, upload, assign, onClose };
}

describe('PhoneProfileSheet', () => {
  it('profile sheet shows initials when there is no photo', () => {
    const adult = renderSheet();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const mark = screen.getByText(initials('Nia Sample'));
    expect(mark).toBeVisible();
    expect(mark).toHaveStyle({ backgroundColor: avatarColor('Nia Sample') });
    expect(screen.getByText('Adult')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Profile · Nia Sample' })).toBeInTheDocument();
    adult.unmount();

    renderSheet({ member: member({ id: 'm-leo', name: 'Leo Sample', category: 'youth' }) });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(initials('Leo Sample'))).toBeVisible();
    expect(screen.getByText('Youth')).toBeInTheDocument();
  });

  it('profile sheet shows the portrait when photoRef is set', () => {
    const currentUrl = '/api/photos/nia.png';
    renderSheet({ member: member({ photoRef: 'nia.png' }), currentUrl });
    const portrait = screen.getByRole('img', { name: 'Nia Sample' });
    expect(portrait).toHaveAttribute('src', currentUrl);
    expect(screen.queryByText(initials('Nia Sample'))).not.toBeInTheDocument();
  });

  it('saving a note trims it, and an empty note is null', async () => {
    const user = userEvent.setup();
    const first = renderSheet();
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.type(field, '  Prefers mornings  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(first.onSaveNote).toHaveBeenCalledTimes(1);
    });
    expect(first.onSaveNote).toHaveBeenCalledWith('Prefers mornings');
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const empty = renderSheet({ member: member({ note: 'Old note' }) });
    const emptyField = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(emptyField);
    await user.type(emptyField, '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(empty.onSaveNote).toHaveBeenCalledTimes(1);
    });
    expect(empty.onSaveNote).toHaveBeenCalledWith(null);
  });

  it('a note over 280 characters cannot be saved', () => {
    renderSheet();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'a'.repeat(281) } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Notes can be at most 280 characters.')).toBeInTheDocument();
    expect(screen.getByText('281 / 280')).toBeInTheDocument();
  });

  it('an unchanged note cannot be saved', async () => {
    const user = userEvent.setup();
    renderSheet({ member: member({ note: 'Prefers mornings' }) });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    await user.type(field, '  Prefers mornings  ');
    expect(save).toBeDisabled();
  });

  it('a refused note save stays open', async () => {
    const user = userEvent.setup();
    const { onSaveNote, onClose } = renderSheet({
      onSaveNote: () => Promise.resolve({ ok: false, message: 'stale member' }),
    });
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the note: stale member');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Profile · Nia Sample' })).toBeInTheDocument();
    expect(onSaveNote).toHaveBeenCalledWith('Hello');
  });

  it('a second save while pending calls onSaveNote once', async () => {
    const user = userEvent.setup();
    let resolveSave: (value: { readonly ok: true }) => void = () => {
      throw new Error('save was not started');
    };
    const onSaveNote = vi.fn<PhoneProfileSheetProps['onSaveNote']>(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onClose = vi.fn();
    renderSheet({ onSaveNote, onClose });
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Hello');
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    await user.click(save);
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolveSave({ ok: true });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('a new photo uploads and assigns without the comparison', async () => {
    const user = userEvent.setup();
    const { upload, assign, onClose } = renderSheet();
    const input = screen.getByLabelText('Upload photo for Nia Sample');
    await user.upload(input, new File(['png'], 'nia.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('m-nia', REF);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    const uploadOrder = upload.mock.invocationCallOrder[0];
    const assignOrder = assign.mock.invocationCallOrder[0];
    if (uploadOrder === undefined || assignOrder === undefined) throw new Error('missing call order');
    expect(uploadOrder).toBeLessThan(assignOrder);
    expect(screen.queryByRole('dialog', { name: "Replace Nia Sample's photo?" })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use New Photo' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('replacing a photo assigns only after Use New Photo', async () => {
    const user = userEvent.setup();
    const { upload, assign } = renderSheet({ member: member({ photoRef: 'already.png' }) });
    const input = screen.getByLabelText('Upload photo for Nia Sample');
    await user.upload(input, new File(['png'], 'nia.png', { type: 'image/png' }));
    expect(screen.getByRole('dialog', { name: "Replace Nia Sample's photo?" })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use New Photo' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('m-nia', REF);
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
