import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoBatchReview, type PhotoBatchStep } from './PhotoBatchReview.tsx';

const ada: PhotoBatchStep = {
  memberName: 'Ada Fictional',
  currentUrl: 'data:image/svg+xml,ada-current',
  incomingUrl: 'data:image/svg+xml,ada-incoming',
};
const ben: PhotoBatchStep = {
  memberName: 'Ben Example',
  currentUrl: 'data:image/svg+xml,ben-current',
  incomingUrl: 'data:image/svg+xml,ben-incoming',
};

function renderReview(steps: readonly PhotoBatchStep[]) {
  const onUseNew = vi.fn();
  const onKeep = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <PhotoBatchReview
      steps={steps}
      sourceLabel="Directory import"
      skippedHousehold={2}
      onUseNew={onUseNew}
      onKeep={onKeep}
      onCancel={onCancel}
    />,
  );
  return { ...view, onUseNew, onKeep, onCancel };
}

describe('PhotoBatchReview', () => {
  it('batch advances one comparison at a time', async () => {
    const user = userEvent.setup();
    const { onKeep, onUseNew, onCancel } = renderReview([ada, ben]);
    expect(screen.getByRole('heading', { name: "Replace Ada Fictional's photo?" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Replace Ben Example's photo?" })).not.toBeInTheDocument();
    expect(screen.getByText('Directory import · 1 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep Current' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledWith(0);
    expect(onUseNew).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: "Replace Ben Example's photo?" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Replace Ada Fictional's photo?" })).not.toBeInTheDocument();
    expect(screen.getByText('Directory import · 2 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use New Photo' }));
    expect(onUseNew).toHaveBeenCalledTimes(1);
    expect(onUseNew).toHaveBeenCalledWith(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Using the new photo for Ben Example.')).toBeInTheDocument();
  });

  it('cancel import stops the rest', async () => {
    const user = userEvent.setup();
    const { onCancel, onKeep, onUseNew } = renderReview([ada, ben]);
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
    expect(onUseNew).not.toHaveBeenCalled();
    expect(screen.getByText('Import cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Replace Ben Example's photo?" })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('last keep says the current photo was kept', async () => {
    const user = userEvent.setup();
    const { onKeep, onUseNew } = renderReview([ada]);
    await user.click(screen.getByRole('button', { name: 'Keep Current' }));
    expect(onKeep).toHaveBeenCalledWith(0);
    expect(onUseNew).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Kept the current photo for Ada Fictional.')).toBeInTheDocument();
    expect(screen.queryByText(/Using the new photo/)).not.toBeInTheDocument();
  });
});
