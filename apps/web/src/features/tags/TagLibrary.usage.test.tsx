import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tagId, type TagId } from '@wardboard/core';
import { describe, expect, it, vi } from 'vitest';
import type { RequestResult } from '../../sync/protocol.ts';
import { okResult, tagsScenario } from './fixtures.ts';
import { TagLibrary } from './TagLibrary.tsx';

function setup(onDeleteRequested = vi.fn()) {
  const s = tagsScenario();
  const onDeleteTag = vi.fn(() => okResult());
  render(
    <TagLibrary
      ward={s.ward}
      usageOf={() => null}
      onCreateTag={() => Promise.resolve<RequestResult<{ tagId: TagId }>>({ ok: true, tagId: tagId('x') })}
      onDeleteTag={onDeleteTag}
      onDeleteRequested={onDeleteRequested}
    />,
  );
  return { s, onDeleteTag, onDeleteRequested, user: userEvent.setup() };
}

describe('TagLibrary pending usage', () => {
  it('null usage: counting text and Delete disabled; Cancel works', async () => {
    const { user, onDeleteTag } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent("Counting where it's used…");
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete tag' }));
    expect(onDeleteTag).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('onDeleteRequested called once per dialog open with the tag id', async () => {
    const { user, s, onDeleteRequested } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    expect(onDeleteRequested).toHaveBeenCalledTimes(1);
    expect(onDeleteRequested).toHaveBeenCalledWith(s.tags.weekday);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete Pianist' }));
    expect(onDeleteRequested).toHaveBeenCalledTimes(2);
    expect(onDeleteRequested).toHaveBeenLastCalledWith(s.tags.pianist);
  });
});
