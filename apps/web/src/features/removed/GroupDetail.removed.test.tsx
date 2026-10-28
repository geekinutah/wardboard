import { render, screen, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findGroup, findMember, slotOfOccupant } from './fixtures.ts';
import { buildRemovedScenario, type RemovedScenario } from './fixtures.ts';
import { GroupDetail, type GroupDetailProps } from '../group-view/GroupDetail.tsx';

function renderGroupDetail(scenario: RemovedScenario, withRemoved: boolean): RenderResult {
  const { data, ward, removed } = scenario;
  const teachersId = findGroup(data.proposal.board, 'Relief Society Teachers').id;
  const props: GroupDetailProps = {
    board: data.proposal.board,
    ward,
    baseline: data.proposal.baseline,
    callingGroupId: teachersId,
    readOnly: true,
    onAddPosition: vi.fn(),
    onAddGroup: vi.fn(),
  };
  return render(<GroupDetail {...(withRemoved ? { ...props, removed } : props)} />);
}

function cardWrappers(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-position-id]'));
}

describe('GroupDetail removed', () => {
  it("removed member's card shows REMOVED text and Removed from Current; others unchanged", () => {
    const scenario = buildRemovedScenario();
    const jo = findMember(scenario.data.ward, 'Jo Testwell');
    const { container } = renderGroupDetail(scenario, true);

    const wrappers = cardWrappers(container);
    const joWrapper = wrappers.find((wrapper) => wrapper.getAttribute('data-member-id') === jo.id);
    expect(joWrapper).toBeDefined();
    const joCard = within(joWrapper as HTMLElement).getByRole('article');
    expect(within(joCard).getByText('Removed from Current')).toBeInTheDocument();
    expect(within(joCard).getByText('REMOVED', { exact: true })).toBeInTheDocument();

    // Every other card in the group keeps its ordinary treatment.
    for (const wrapper of wrappers) {
      if (wrapper.getAttribute('data-member-id') === jo.id) {
        continue;
      }
      const article = wrapper.querySelector('article');
      expect(article).not.toBeNull();
      expect(within(article as HTMLElement).queryByText('Removed from Current')).toBeNull();
      expect(within(article as HTMLElement).queryByText('REMOVED', { exact: true })).toBeNull();
    }
  });

  it('removed position shows POSITION REMOVED and keeps its occupant name', () => {
    const scenario = buildRemovedScenario();
    const kit = findMember(scenario.data.ward, 'Kit Notreal');
    const teachersGroup = findGroup(scenario.data.proposal.board, 'Relief Society Teachers');
    const kitSlot = slotOfOccupant(scenario.data.proposal.board, teachersGroup, kit);
    const { container } = renderGroupDetail(scenario, true);

    const wrapper = container.querySelector<HTMLElement>(`[data-position-id="${kitSlot.id}"]`);
    expect(wrapper).not.toBeNull();
    // The card keeps its data- ids (T-034/T-035 rely on them) and the occupant's name.
    expect(wrapper).toHaveAttribute('data-member-id', kit.id);
    const card = within(wrapper as HTMLElement).getByRole('article');
    expect(within(card).getByText('POSITION REMOVED', { exact: true })).toBeInTheDocument();
    expect(within(card).getByText('Position removed from Current')).toBeInTheDocument();
    expect(within(card).getByText('Kit Notreal')).toBeInTheDocument();
  });

  it('vacancy counts and + Proposed text unchanged with removed set', () => {
    const scenario = buildRemovedScenario();
    const control = renderGroupDetail(scenario, false);
    const removedView = renderGroupDetail(scenario, true);

    // Same structure: same number of cards, same list count, same data- ids.
    const controlCards = cardWrappers(control.container);
    const removedCards = cardWrappers(removedView.container);
    expect(removedCards.map((card) => card.getAttribute('data-position-id'))).toEqual(
      controlCards.map((card) => card.getAttribute('data-position-id')),
    );

    const count = screen.getAllByText('List · 4 of 4 filled');
    expect(count).toHaveLength(2);

    // Ivy Notreal was placed by the preview harness: her card keeps the + Proposed chip.
    const ivy = findMember(scenario.data.ward, 'Ivy Notreal');
    const ivyWrapper = removedView.container.querySelector<HTMLElement>(`[data-member-id="${ivy.id}"]`);
    expect(ivyWrapper).not.toBeNull();
    expect(within(ivyWrapper as HTMLElement).getByText('+ Proposed')).toBeInTheDocument();
  });
});
