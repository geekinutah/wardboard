import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteTag, tagUsage, tagId, type TagId, type Ward } from '@wardboard/core';
import { describe, expect, it, vi } from 'vitest';
import type { RequestResult } from '../../sync/protocol.ts';
import { okResult, refusal, tagsScenario } from './fixtures.ts';
import { TagLibrary, type TagLibraryProps } from './TagLibrary.tsx';

function setup(overrides: Partial<TagLibraryProps> = {}) {
  const s = tagsScenario();
  const ward = overrides.ward ?? s.ward;
  const props: TagLibraryProps = {
    ward,
    usageOf: (id) => tagUsage(ward, [s.current, s.proposal.baseline, s.proposal.board], id),
    onCreateTag: vi.fn(() => Promise.resolve<RequestResult<{ tagId: TagId }>>({ ok: true, tagId: tagId('new-1') })),
    onDeleteTag: vi.fn(() => okResult()),
    ...overrides,
  };
  render(<TagLibrary {...props} />);
  return { s, props, user: userEvent.setup() };
}

describe('TagLibrary', () => {
  it('rows sorted by name with member counts', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Tag library' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tag' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Used' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      'Evenings only1Delete Evenings only',
      'Outdoors0Delete Outdoors',
      'Pianist1Delete Pianist',
      'Weekday2Delete Weekday',
    ]);
  });

  it('an empty library says No tags yet.', () => {
    const s = tagsScenario();
    setup({ ward: { members: s.ward.members, tags: {} } });
    expect(screen.getByText('No tags yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('delete dialog shows usage copy; Cancel and Escape do not call back', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Weekday”?' });
    expect(dialog).toHaveTextContent(
      'Removes it from 2 people and from the preferences on 1 calling. Nothing else changes.',
    );
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Outdoors' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('and the tags on 1 calling');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onDeleteTag).not.toHaveBeenCalled();
  });

  it('Delete tag calls onDeleteTag and closes; refusal keeps it open with alert', async () => {
    const first = setup();
    await first.user.click(screen.getByRole('button', { name: 'Delete Pianist' }));
    await first.user.click(screen.getByRole('button', { name: 'Delete tag' }));
    expect(first.props.onDeleteTag).toHaveBeenCalledWith(first.s.tags.pianist);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    cleanup();
    const { user } = setup({
      onDeleteTag: vi.fn(() => refusal('not_found', 'Already gone.')),
    });
    await user.click(screen.getByRole('button', { name: 'Delete Pianist' }));
    await user.click(screen.getByRole('button', { name: 'Delete tag' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Already gone.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('new tag: empty and duplicate names are refused without callback', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: '+ New tag' }));
    const input = screen.getByRole('textbox', { name: 'New tag name' });
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a tag name.');
    await user.clear(input);
    await user.type(input, ' weekday ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A tag named “weekday” already exists.');
    expect(props.onCreateTag).not.toHaveBeenCalled();
  });

  it('new tag: Save calls onCreateTag with the trimmed name and closes the form', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: '+ New tag' }));
    await user.type(screen.getByRole('textbox', { name: 'New tag name' }), '  Teaching ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onCreateTag).toHaveBeenCalledWith('Teaching');
    await vi.waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'New tag name' })).not.toBeInTheDocument();
    });
  });

  it('new tag: a refused create keeps the form open with the message; Cancel closes it', async () => {
    const { user } = setup({
      onCreateTag: vi.fn(() => refusal<{ tagId: TagId }>('invalid_name', 'Bad name.')),
    });
    await user.click(screen.getByRole('button', { name: '+ New tag' }));
    await user.type(screen.getByRole('textbox', { name: 'New tag name' }), 'Teaching');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad name.');
    expect(screen.getByRole('textbox', { name: 'New tag name' })).toHaveValue('Teaching');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'New tag name' })).not.toBeInTheDocument();
  });

  it('Needs approval never appears in the library', () => {
    setup();
    expect(screen.queryByText(/needs approval/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('uses singular copy for a tag used by one person and zero preferences', async () => {
    const s = tagsScenario();
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete Evenings only' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Removes it from 1 person and from the preferences on 0 callings. Nothing else changes.',
    );
    expect(s.tags.evenings).toBeDefined();
  });

  it('removing a tag from the ward updates the table (props-driven)', () => {
    const s = tagsScenario();
    const result = deleteTag(s.ward, [s.current], s.tags.pianist);
    if (!result.ok) throw new Error(result.error.message);
    const ward: Ward = result.value.ward;
    setup({ ward });
    expect(screen.queryByRole('button', { name: 'Delete Pianist' })).not.toBeInTheDocument();
  });
});
