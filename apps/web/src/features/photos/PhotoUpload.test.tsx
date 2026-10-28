import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoUpload, type PhotoUploadProps } from './PhotoUpload.tsx';
import type { PhotoMember } from './plan.ts';

const REF = `${'ab'.repeat(32)}.jpg`;

function renderUpload(member: PhotoMember, overrides: Partial<PhotoUploadProps> = {}) {
  const upload = vi.fn<PhotoUploadProps['upload']>(
    overrides.upload ?? (() => Promise.resolve({ photoRef: REF })),
  );
  const assign = vi.fn<PhotoUploadProps['assign']>(overrides.assign ?? (() => Promise.resolve()));
  const view = render(<PhotoUpload member={member} upload={upload} assign={assign} />);
  return { ...view, upload, assign, input: screen.getByLabelText(`Upload photo for ${member.name}`) };
}

describe('PhotoUpload', () => {
  it('first photo uploads and assigns without a dialog', async () => {
    const user = userEvent.setup();
    const member: PhotoMember = { id: 'cal-sample', name: 'Cal Sample', photoRef: null };
    const { upload, assign, input } = renderUpload(member);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
    const file = new File(['png'], 'cal.png', { type: 'image/png' });
    await user.upload(input, file);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toBeInstanceOf(File);
    expect(upload.mock.calls[0]?.[0]?.type).toBe('image/png');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('cal-sample', REF);
    const uploadOrder = upload.mock.invocationCallOrder[0];
    const assignOrder = assign.mock.invocationCallOrder[0];
    if (uploadOrder === undefined || assignOrder === undefined) throw new Error('missing call order');
    expect(uploadOrder).toBeLessThan(assignOrder);
    expect(await screen.findByText('Photo added for Cal Sample')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('replacement does not upload until Use New Photo', async () => {
    const user = userEvent.setup();
    const member: PhotoMember = { id: 'ada', name: 'Ada Fictional', photoRef: 'already-there' };
    const file = new File(['png'], 'ada.png', { type: 'image/png' });

    const kept = renderUpload(member);
    await user.upload(kept.input, file);
    expect(kept.upload).not.toHaveBeenCalled();
    expect(kept.assign).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: "Replace Ada Fictional's photo?" })).toBeInTheDocument();
    expect(screen.getByText('Direct upload · 1 of 1')).toBeInTheDocument();
    expect(screen.queryByText(/household image/i)).not.toBeInTheDocument();
    const current = screen.getByRole('img', { name: 'Current portrait of Ada Fictional' });
    expect(current.tagName).toBe('DIV');
    expect(current).toHaveTextContent('AF');
    expect(screen.getByRole('img', { name: 'Incoming portrait of Ada Fictional' }).getAttribute('src')).toMatch(
      /^blob:/,
    );
    await user.click(screen.getByRole('button', { name: 'Keep Current' }));
    expect(kept.upload).not.toHaveBeenCalled();
    expect(kept.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/new photo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Photo added/)).not.toBeInTheDocument();
    kept.unmount();

    const cancelled = renderUpload(member);
    await user.upload(cancelled.input, file);
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(cancelled.upload).not.toHaveBeenCalled();
    expect(cancelled.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/new photo/i)).not.toBeInTheDocument();
    cancelled.unmount();

    const used = renderUpload(member);
    await user.upload(used.input, file);
    expect(used.upload).not.toHaveBeenCalled();
    expect(used.assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use New Photo' }));
    expect(used.upload).toHaveBeenCalledTimes(1);
    expect(used.assign).toHaveBeenCalledTimes(1);
    expect(used.assign).toHaveBeenCalledWith('ada', REF);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Using the new photo for Ada Fictional.')).toBeInTheDocument();
  });

  it('a non-image shows the JPEG or PNG message', async () => {
    // user-event drops files the accept attribute rejects before change fires.
    const user = userEvent.setup({ applyAccept: false });
    const member: PhotoMember = { id: 'cal-sample', name: 'Cal Sample', photoRef: null };
    const { upload, assign, input } = renderUpload(member);
    const file = new File(['hello'], 'portrait.png', { type: 'text/plain' });
    await user.upload(input, file);
    expect(screen.getByText('Choose a JPEG or PNG.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Photo added for Cal Sample')).not.toBeInTheDocument();
  });

  it('a failed upload shows an alert and does not assign', async () => {
    const user = userEvent.setup();
    const member: PhotoMember = { id: 'cal-sample', name: 'Cal Sample', photoRef: null };
    const upload = vi.fn<PhotoUploadProps['upload']>(() => Promise.reject(new Error('disk full')));
    const { assign, input } = renderUpload(member, { upload });
    await user.upload(input, new File(['png'], 'cal.png', { type: 'image/png' }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByText('Photo added for Cal Sample')).not.toBeInTheDocument();
  });
});
