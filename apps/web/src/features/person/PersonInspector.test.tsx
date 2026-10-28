import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  addToDugout,
  memberId,
  sequentialIds,
  tagId,
  type Board,
  type Member,
  type OperationResult,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { PersonInspector, type PersonInspectorProps } from './PersonInspector.tsx';

function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function memberByName(ward: Ward, name: string): Member {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`member ${name} not found`);
  }
  return found;
}

function tagByName(ward: Ward, name: string) {
  const found = Object.values(ward.tags).find((tag) => tag.name === name);
  if (found === undefined) {
    throw new Error(`tag ${name} not found`);
  }
  return found;
}

function proposalBoard(current: Board, ward: Ward): Board {
  return buildFixtureProposal(current, ward).board;
}

function renderInspector(overrides: Partial<PersonInspectorProps> & Pick<PersonInspectorProps, 'board' | 'ward' | 'memberId'>) {
  const onOpenNotes = overrides.onOpenNotes ?? vi.fn();
  const onAddToDugout = overrides.onAddToDugout ?? vi.fn();
  const props: PersonInspectorProps = {
    board: overrides.board,
    ward: overrides.ward,
    memberId: overrides.memberId,
    readOnly: overrides.readOnly ?? false,
    onOpenNotes,
    onAddToDugout,
  };
  const view = render(<PersonInspector {...props} />);
  return { ...view, props, onOpenNotes, onAddToDugout };
}

describe('PersonInspector', () => {
  it("lists both of Jo Testwell's callings with group and organization", () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberByName(ward, 'Jo Testwell');
    renderInspector({ board: current, ward, memberId: jo.id });

    expect(screen.getByRole('complementary', { name: 'Person: Jo Testwell' })).toHaveAttribute('data-member-id', jo.id);
    expect(screen.getByRole('heading', { level: 2, name: 'Jo Testwell' })).toBeInTheDocument();
    expect(screen.getByText('Adult')).toBeInTheDocument();
    expect(screen.getByText('Serves in 2 callings')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Callings in Current' });
    expect(screen.getByText('Serves in 2 callings').compareDocumentPosition(list)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = items[0];
    const second = items[1];
    if (first === undefined || second === undefined) {
      throw new Error('expected two calling rows');
    }
    expect(first).toHaveTextContent('Relief Society Teacher');
    expect(first).toHaveTextContent('Relief Society Teachers · Relief Society');
    const firstText = first.textContent;
    expect(firstText.indexOf('Relief Society Teachers · Relief Society')).toBeGreaterThan(
      firstText.indexOf('Relief Society Teacher'),
    );
    expect(second).toHaveTextContent('Nursery Leader');
    expect(second).toHaveTextContent('Nursery · Primary');
    const secondText = second.textContent;
    expect(secondText.indexOf('Nursery · Primary')).toBeGreaterThan(secondText.indexOf('Nursery Leader'));
  });

  it('heading says this proposal on a proposal and Current on current', () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberByName(ward, 'Jo Testwell');
    const { unmount } = renderInspector({ board: current, ward, memberId: jo.id });
    expect(screen.getByRole('heading', { name: 'Callings in Current' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Callings in this proposal' })).not.toBeInTheDocument();
    unmount();

    renderInspector({ board: proposalBoard(current, ward), ward, memberId: jo.id });
    expect(screen.getByRole('heading', { name: 'Callings in this proposal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Callings in Current' })).not.toBeInTheDocument();
  });

  it('a member with no calling says No calling in this proposal and In the dugout', () => {
    const { ward, current } = buildFixtureWard();
    const jay = memberByName(ward, 'Jay Storybook');
    renderInspector({ board: proposalBoard(current, ward), ward, memberId: jay.id });

    expect(screen.getByText('No calling in this proposal')).toBeInTheDocument();
    expect(screen.queryByText('No calling in Current')).not.toBeInTheDocument();
    expect(screen.getByText('In the dugout')).toBeInTheDocument();
    expect(screen.queryByText('In the dugout · placed here on purpose')).not.toBeInTheDocument();
    expect(screen.queryByText('Serves in 1 callings')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to dugout' })).toBeInTheDocument();
  });

  it('explicit inclusion says placed here on purpose and hides Add to dugout', () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberByName(ward, 'Jo Testwell');
    const board = expectOk(
      addToDugout(proposalBoard(current, ward), { ward, ids: sequentialIds('person') }, { memberId: jo.id }),
    );
    renderInspector({ board, ward, memberId: jo.id });

    expect(screen.getByText('In the dugout · placed here on purpose')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open notes' })).toBeInTheDocument();
    expect(screen.getByText('Serves in 2 callings')).toBeInTheDocument();
    expect(screen.getByText('Relief Society Teacher')).toBeInTheDocument();
    expect(screen.getByText('Nursery Leader')).toBeInTheDocument();
  });

  it('never renders the note body', () => {
    const { ward, current } = buildFixtureWard();
    const jay = memberByName(ward, 'Jay Storybook');
    const { container } = renderInspector({ board: current, ward, memberId: jay.id });

    expect(container.innerHTML).not.toContain('Travels for work');
    expect(screen.getByRole('button', { name: 'Open notes' })).toBeInTheDocument();
  });

  it('Open notes and Add to dugout call back with the member id', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const jo = memberByName(ward, 'Jo Testwell');
    const { onOpenNotes, onAddToDugout } = renderInspector({
      board: proposalBoard(current, ward),
      ward,
      memberId: jo.id,
    });

    await user.click(screen.getByRole('button', { name: 'Open notes' }));
    await user.click(screen.getByRole('button', { name: 'Add to dugout' }));

    expect(onOpenNotes).toHaveBeenCalledTimes(1);
    expect(onOpenNotes).toHaveBeenCalledWith(jo.id);
    expect(onAddToDugout).toHaveBeenCalledTimes(1);
    expect(onAddToDugout).toHaveBeenCalledWith(jo.id);
  });

  it('readOnly hides Add to dugout but keeps Open notes', () => {
    const { ward, current } = buildFixtureWard();
    const mia = memberByName(ward, 'Mia Sample');
    renderInspector({ board: current, ward, memberId: mia.id, readOnly: true });

    expect(screen.getByText('Youth')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open notes' })).toBeInTheDocument();
  });

  it('tags and Needs approval are text, unknown tag ids skipped', () => {
    const { ward, current } = buildFixtureWard();
    const cy = memberByName(ward, 'Cy Mockup');
    const spanish = tagByName(ward, 'Spanish speaker');
    const weekday = tagByName(ward, 'Weekday availability');
    const missing = tagId('tag-missing');
    const tagged: Member = { ...cy, tagIds: [missing, spanish.id, weekday.id] };
    const wardCopy: Ward = { ...ward, members: { ...ward.members, [cy.id]: tagged } };
    const { container } = renderInspector({ board: current, ward: wardCopy, memberId: cy.id });

    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    const tags = screen.getByRole('list', { name: 'Tags' });
    const items = within(tags).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Spanish speaker', 'Weekday availability']);
    expect(within(tags).queryByText('Needs approval')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('tag-missing');
    expect(container.innerHTML).not.toContain('tag-missing');
  });

  it('outside callings are listed only when present', () => {
    const { ward, current } = buildFixtureWard();
    const kai = memberByName(ward, 'Kai Fictional');
    const { unmount } = renderInspector({ board: current, ward, memberId: kai.id });
    expect(screen.getByRole('heading', { name: 'Outside the ward' })).toBeInTheDocument();
    expect(screen.getByText('Stake Young Single Adult Adviser · Example Stake')).toBeInTheDocument();
    unmount();

    const jo = memberByName(ward, 'Jo Testwell');
    renderInspector({ board: current, ward, memberId: jo.id });
    expect(screen.queryByRole('heading', { name: 'Outside the ward' })).not.toBeInTheDocument();
    expect(screen.queryByText('None listed')).not.toBeInTheDocument();
  });

  it('removed member shows the removed date and no Add to dugout', () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberByName(ward, 'Jo Testwell');
    const removed: Member = { ...jo, removedDate: '2026-01-02' };
    const wardCopy: Ward = { ...ward, members: { ...ward.members, [jo.id]: removed } };
    renderInspector({ board: proposalBoard(current, wardCopy), ward: wardCopy, memberId: jo.id });

    expect(screen.getByText('Removed from Current on 2026-01-02')).toBeInTheDocument();
    expect(screen.queryByText('January 2, 2026')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jo Testwell' })).toBeInTheDocument();
    expect(screen.getByText('Relief Society Teacher')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open notes' })).toBeInTheDocument();
  });

  it('unknown member id shows the not-in-ward message', () => {
    const { ward, current } = buildFixtureWard();
    const missing = memberId('m-missing');
    renderInspector({ board: current, ward, memberId: missing });

    const aside = screen.getByRole('complementary', { name: 'Person' });
    expect(aside).toHaveTextContent('This person is not in the ward.');
    expect(aside).not.toHaveTextContent('Open notes');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Adult')).not.toBeInTheDocument();
    expect(screen.queryByText('Youth')).not.toBeInTheDocument();
  });
});
