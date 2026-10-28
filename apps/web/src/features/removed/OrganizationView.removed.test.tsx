import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoardGroupId } from '@wardboard/core';
import { findGroup, findMember, slotOfOccupant } from './fixtures.ts';
import { buildOrgRemovedScenario, type RemovedScenario } from './fixtures.ts';
import { OrganizationView } from '../org-view/OrganizationView.tsx';

function reliefSocietyBoardGroupId(data: RemovedScenario['data']): BoardGroupId {
  const group = Object.values(data.proposal.board.boardGroups).find((candidate) => candidate.key === 'relief_society');
  if (group === undefined) {
    throw new Error('Relief Society board group not found');
  }
  return group.id;
}

describe('OrganizationView removed', () => {
  it('removed leader card shows REMOVED text', () => {
    const scenario = buildOrgRemovedScenario();
    const { data, ward, removed } = scenario;
    const faye = findMember(data.ward, 'Faye Pretend');
    const gwen = findMember(data.ward, 'Gwen Imaginary');
    const hana = findMember(data.ward, 'Hana Madeup');
    const iris = findMember(data.ward, 'Iris Demo');

    const { container } = render(
      <OrganizationView
        board={data.proposal.board}
        ward={ward}
        baseline={data.proposal.baseline}
        boardGroupId={reliefSocietyBoardGroupId(data)}
        removed={removed}
      />,
    );

    const leadership = container.querySelectorAll<HTMLElement>('[data-position-id]');
    expect(leadership.length).toBeGreaterThanOrEqual(4);

    const wrapperFor = (memberId: string) =>
      Array.from(leadership).find((wrapper) => wrapper.getAttribute('data-member-id') === memberId);

    // The removed president is marked; the marker text, not just the hatch, carries the state.
    const fayeWrapper = wrapperFor(faye.id) as HTMLElement;
    const fayeCard = within(fayeWrapper).getByRole('article');
    expect(within(fayeCard).getByText('Removed from Current')).toBeInTheDocument();
    expect(within(fayeCard).getByText('REMOVED', { exact: true })).toBeInTheDocument();

    // Unaffected leaders keep the ordinary card.
    for (const member of [gwen, hana]) {
      const wrapper = wrapperFor(member.id) as HTMLElement;
      const card = within(wrapper).getByRole('article');
      expect(within(card).queryByText('Removed from Current')).toBeNull();
      expect(within(card).queryByText('REMOVED', { exact: true })).toBeNull();
    }

    // The removed secretary slot (a removed position) shows the position marker and keeps its occupant name.
    const presidency = findGroup(data.proposal.board, 'Relief Society Presidency');
    const secretarySlot = slotOfOccupant(data.proposal.board, presidency, iris);
    const irisWrapper = Array.from(leadership).find(
      (wrapper) => wrapper.getAttribute('data-position-id') === secretarySlot.id,
    ) as HTMLElement;
    const irisCard = within(irisWrapper).getByRole('article');
    expect(within(irisCard).getByText('POSITION REMOVED', { exact: true })).toBeInTheDocument();
    expect(within(irisCard).getByText('Position removed from Current')).toBeInTheDocument();
    expect(within(irisCard).getByText('Iris Demo')).toBeInTheDocument();
  });
});
