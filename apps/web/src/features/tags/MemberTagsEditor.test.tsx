import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { tagId, type Member, type TagId, type Ward } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { okResult, refusal, tagsScenario } from './fixtures.ts';
import { MemberTagsEditor, type MemberTagsEditorProps } from './MemberTagsEditor.tsx';

function member(ward: Ward, name: string): Member {
  const found = Object.values(ward.members).find((m) => m.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

function setup(overrides: Partial<MemberTagsEditorProps> = {}, memberName = 'Ann Alpha') {
  const s = tagsScenario();
  const ward = overrides.ward ?? s.ward;
  const props: MemberTagsEditorProps = {
    member: member(ward, memberName),
    ward,
    isAdmin: true,
    onSetTags: vi.fn(() => okResult()),
    onCreateTag: vi.fn(() => Promise.resolve<RequestResult<{ tagId: TagId }>>({ ok: true, tagId: tagId('new-1') })),
    onSetNeedsApproval: vi.fn(() => okResult()),
    ...overrides,
  };
  render(<MemberTagsEditor {...props} />);
  return { s, props, user: userEvent.setup() };
}

describe('MemberTagsEditor', () => {
  it('shows eyebrow, member name, chips in member order and the shared note', () => {
    setup();
    expect(screen.getByText('MEMBER TAGS · WARD-WIDE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ann Alpha' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove tag / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove tag Weekday',
      'Remove tag Pianist',
    ]);
    expect(
      screen.getByText('Member tags are shared: changes show in Current and every proposal.'),
    ).toBeInTheDocument();
  });

  it('removing a chip calls onSetTags without that tag', async () => {
    const { s, props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove tag Weekday' }));
    expect(props.onSetTags).toHaveBeenCalledTimes(1);
    expect(props.onSetTags).toHaveBeenCalledWith([s.tags.pianist]);
  });

  it('keyboard picks a suggestion and clears the input', async () => {
    const { s, props, user } = setup();
    const input = screen.getByRole('combobox', { name: 'Add a tag' });
    await user.type(input, 'o');
    // Ann carries Weekday and Pianist; "o" matches Outdoors only (Evenings only also has "o").
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Evenings only1 person',
      'Outdoors0 people',
      'Create tag “o”',
    ]);
    await user.keyboard('{ArrowDown}{Enter}');
    // Active starts at the first option; ArrowDown moves to Outdoors.
    expect(props.onSetTags).toHaveBeenCalledWith([s.tags.weekday, s.tags.pianist, s.tags.outdoors]);
    expect(input).toHaveValue('');
  });

  it('clicking an option picks it', async () => {
    const { s, props, user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Add a tag' }));
    await user.click(screen.getByRole('option', { name: /Evenings only/ }));
    expect(props.onSetTags).toHaveBeenCalledWith([s.tags.weekday, s.tags.pianist, s.tags.evenings]);
  });

  it('Escape closes the list', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Add a tag' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Create tag creates then adds the new tag', async () => {
    const { s, props, user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add a tag' }), 'Brand new');
    await user.click(screen.getByRole('option', { name: 'Create tag “Brand new”' }));
    expect(props.onCreateTag).toHaveBeenCalledWith('Brand new');
    await vi.waitFor(() => {
      expect(props.onSetTags).toHaveBeenCalledWith([s.tags.weekday, s.tags.pianist, tagId('new-1')]);
    });
  });

  it('a refused create does not add a tag and shows the message', async () => {
    const { props, user } = setup({
      onCreateTag: vi.fn(() => refusal<{ tagId: TagId }>('duplicate_tag_name', 'Nope.')),
    });
    await user.type(screen.getByRole('combobox', { name: 'Add a tag' }), 'Zed');
    await user.click(screen.getByRole('option', { name: 'Create tag “Zed”' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
    expect(props.onSetTags).not.toHaveBeenCalled();
  });

  it('a query exactly matching a carried tag offers nothing', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add a tag' }), 'weekday');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('a member with no tags has no chips and the combobox still works', async () => {
    const { s, props, user } = setup({}, 'Bob Beta');
    expect(screen.queryAllByRole('button', { name: /^Remove tag / })).toHaveLength(0);
    await user.click(screen.getByRole('combobox', { name: 'Add a tag' }));
    await user.click(screen.getByRole('option', { name: /Pianist/ }));
    expect(props.onSetTags).toHaveBeenCalledWith([s.tags.pianist]);
  });

  it('a ward with no tags only offers create once something is typed', async () => {
    const s = tagsScenario();
    const ward: Ward = { members: s.ward.members, tags: {} };
    const { user } = setup({ ward, member: { ...member(s.ward, 'Bob Beta'), tagIds: [] } });
    const input = screen.getByRole('combobox', { name: 'Add a tag' });
    await user.click(input);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    await user.type(input, 'x');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Create tag “x”']);
  });

  it('admin sees the Needs approval switch; toggling calls back with the negation', async () => {
    const { props, user } = setup();
    expect(screen.getByRole('heading', { name: 'Placement setting' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Needs approval' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(props.onSetNeedsApproval).toHaveBeenCalledWith(true);
    expect(
      screen.getByText(
        'Every proposed placement must be approved by an Editor. Not a tag · shown on TV only if an Admin allows it.',
      ),
    ).toBeInTheDocument();
  });

  it('the switch reflects a member who already needs approval', async () => {
    const s = tagsScenario();
    const { props, user } = setup({ member: { ...member(s.ward, 'Ann Alpha'), needsApproval: true } });
    const toggle = screen.getByRole('switch', { name: 'Needs approval' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(props.onSetNeedsApproval).toHaveBeenCalledWith(false);
  });

  it('editor sees read-only Needs approval text and no switch', () => {
    const s = tagsScenario();
    setup({ isAdmin: false, member: { ...member(s.ward, 'Ann Alpha'), needsApproval: true } });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Needs approval: On')).toBeInTheDocument();
    expect(screen.getByText('Only Admins can change this.')).toBeInTheDocument();
  });

  it('editor sees Off for a member who does not need approval', () => {
    setup({ isAdmin: false });
    expect(screen.getByText('Needs approval: Off')).toBeInTheDocument();
  });

  it('refusal shows the message and keeps the chips', async () => {
    const { user } = setup({
      onSetTags: vi.fn(() => refusal('not_found', 'Tag is gone.')),
    });
    await user.click(screen.getByRole('button', { name: 'Remove tag Weekday' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tag is gone.');
    expect(screen.getByRole('button', { name: 'Remove tag Weekday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag Pianist' })).toBeInTheDocument();
  });

  it('a refused Needs approval change shows the message and keeps the switch state', async () => {
    const { user } = setup({
      onSetNeedsApproval: vi.fn(() =>
        refusal('forbidden', 'Admins only.'),
      ),
    });
    await user.click(screen.getByRole('switch', { name: 'Needs approval' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.');
    expect(screen.getByRole('switch', { name: 'Needs approval' })).toHaveAttribute('aria-checked', 'false');
  });

  it('disables the control while a callback is pending', async () => {
    let resolve: (r: RequestResult) => void = () => undefined;
    const { user } = setup({
      onSetNeedsApproval: vi.fn(
        () =>
          new Promise<RequestResult>((r) => {
            resolve = r;
          }),
      ),
    });
    await user.click(screen.getByRole('switch', { name: 'Needs approval' }));
    expect(screen.getByRole('switch', { name: 'Needs approval' })).toBeDisabled();
    resolve({ ok: true } as RequestResult);
    await vi.waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Needs approval' })).toBeEnabled();
    });
  });

  it('shows each suggestion with a people count', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Add a tag' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: /Evenings only/ })).toHaveTextContent('1 person');
    expect(within(list).getByRole('option', { name: /Outdoors/ })).toHaveTextContent('0 people');
  });
});
