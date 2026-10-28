import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { tagId, type TagId } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { okResult, tagsScenario } from './fixtures.ts';
import { MemberTagsEditor } from './MemberTagsEditor.tsx';

function setup(showName?: boolean) {
  const s = tagsScenario();
  const found = Object.values(s.ward.members).find((m) => m.name === 'Ann Alpha');
  if (found === undefined) throw new Error('no Ann Alpha');
  const onSetTags = vi.fn(() => okResult());
  render(
    <MemberTagsEditor
      member={found}
      ward={s.ward}
      isAdmin
      onSetTags={onSetTags}
      onCreateTag={() => Promise.resolve<RequestResult<{ tagId: TagId }>>({ ok: true, tagId: tagId('new-1') })}
      onSetNeedsApproval={() => okResult()}
      {...(showName === undefined ? {} : { showName })}
    />,
  );
  return { s, onSetTags };
}

describe('MemberTagsEditor embedded (showName)', () => {
  it('showName={false}: no name heading, region labelled Member tags, chips still work', async () => {
    const { s, onSetTags } = setup(false);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ann Alpha' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Member tags' })).toBeInTheDocument();
    expect(screen.getByText('MEMBER TAGS · WARD-WIDE')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove tag Weekday' }));
    expect(onSetTags).toHaveBeenCalledWith([s.tags.pianist]);
  });

  it('showName omitted: still renders the member name heading', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Ann Alpha' })).toBeInTheDocument();
  });
});
