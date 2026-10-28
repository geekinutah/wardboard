import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { addToDugout, sequentialIds, type MemberId, type Ward } from '@wardboard/core';
import { OutOfUnitView } from './OutOfUnitView.tsx';

function findMemberId(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((m) => m.name === name);
  if (!found) throw new Error(`Member ${name} not found`);
  return found.id;
}

describe('OutOfUnitView', () => {
  it('view lists each member with outside callings and category', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    render(<OutOfUnitView board={proposal.board} ward={ward} readOnly={false} onAddToDugout={() => {}} />);

    // Kai: Adult, Stake Young Single Adult Adviser · Example Stake
    const kaiId = findMemberId(ward, 'Kai Fictional');
    const kaiArticle = document.querySelector(`article[data-member-id="${kaiId}"]`);
    expect(kaiArticle).not.toBeNull();
    expect(kaiArticle).toHaveTextContent('Kai Fictional');
    expect(kaiArticle).toHaveTextContent('Adult');
    expect(kaiArticle).toHaveTextContent('Stake Young Single Adult Adviser · Example Stake');

    // Hal: Stake Family History Consultant · Example Stake and Also serves in the ward as Temple and Family History Consultant
    const halId = findMemberId(ward, 'Hal Testwell');
    const halArticle = document.querySelector(`article[data-member-id="${halId}"]`);
    expect(halArticle).not.toBeNull();
    expect(halArticle).toHaveTextContent('Hal Testwell');
    expect(halArticle).toHaveTextContent('Adult');
    expect(halArticle).toHaveTextContent('Stake Family History Consultant · Example Stake');
    expect(halArticle).toHaveTextContent('Also serves in the ward as Temple and Family History Consultant');
  });

  it('view has no vacancy, add-position, release or move controls', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    render(<OutOfUnitView board={proposal.board} ward={ward} readOnly={false} onAddToDugout={() => {}} />);

    expect(screen.queryByText(/Vacant/i)).toBeNull();
    expect(screen.queryByText(/\+ add position/i)).toBeNull();
    expect(screen.queryByText(/Release/i)).toBeNull();
    expect(screen.queryByText(/Move/i)).toBeNull();
  });

  it('Add to dugout calls back with the id and hides after explicit inclusion', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const kaiId = findMemberId(ward, 'Kai Fictional');
    const onAddToDugout = vi.fn();

    const { rerender } = render(
      <OutOfUnitView board={proposal.board} ward={ward} readOnly={false} onAddToDugout={onAddToDugout} />,
    );

    const kaiArticle = document.querySelector(`article[data-member-id="${kaiId}"]`);
    expect(kaiArticle).not.toBeNull();
    if (kaiArticle === null) throw new Error('kaiArticle is null');
    const addButton = kaiArticle.querySelector('button');
    expect(addButton).not.toBeNull();
    if (addButton === null) throw new Error('addButton is null');
    expect(addButton).toHaveTextContent('Add to dugout');
    await user.click(addButton);
    expect(onAddToDugout).toHaveBeenCalledWith(kaiId);

    // Apply addToDugout to proposal board
    const opResult = addToDugout(proposal.board, { ward, ids: sequentialIds('test') }, { memberId: kaiId });
    if (!opResult.ok) throw new Error(opResult.error.message);

    rerender(
      <OutOfUnitView board={opResult.board} ward={ward} readOnly={false} onAddToDugout={onAddToDugout} />,
    );

    const updatedKaiArticle = document.querySelector(`article[data-member-id="${kaiId}"]`);
    expect(updatedKaiArticle).not.toBeNull();
    if (updatedKaiArticle === null) throw new Error('updatedKaiArticle is null');
    expect(updatedKaiArticle.querySelector('button')).toBeNull();
    expect(updatedKaiArticle).toHaveTextContent('In the dugout · placed here on purpose');
  });

  it('readOnly hides Add to dugout', () => {
    const { ward, current } = buildFixtureWard();
    render(<OutOfUnitView board={current} ward={ward} readOnly={true} onAddToDugout={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Add to dugout' })).toBeNull();
  });

  it('removed members are not listed', () => {
    const { ward, current } = buildFixtureWard();
    const kaiId = findMemberId(ward, 'Kai Fictional');
    const halId = findMemberId(ward, 'Hal Testwell');
    const kaiMember = ward.members[kaiId];
    if (kaiMember === undefined) throw new Error('missing kai');
    const removedWard: Ward = {
      ...ward,
      members: {
        ...ward.members,
        [kaiId]: { ...kaiMember, removedDate: '2026-03-01' },
      },
    };

    render(<OutOfUnitView board={current} ward={removedWard} readOnly={true} onAddToDugout={() => {}} />);

    expect(document.querySelector(`article[data-member-id="${kaiId}"]`)).toBeNull();
    expect(document.querySelector(`article[data-member-id="${halId}"]`)).not.toBeNull();
  });

  it('empty ward shows the none message', () => {
    const { ward, current } = buildFixtureWard();
    const emptiedWard: Ward = {
      ...ward,
      members: Object.fromEntries(
        Object.entries(ward.members).map(([id, m]) => [id, { ...m, externalCallings: [] }]),
      ),
    };

    render(<OutOfUnitView board={current} ward={emptiedWard} readOnly={false} onAddToDugout={() => {}} />);

    expect(screen.getByText('No one in the ward holds a calling outside it.')).toBeInTheDocument();
  });

  it('never renders a note', () => {
    const { ward, current } = buildFixtureWard();
    const kaiId = findMemberId(ward, 'Kai Fictional');
    const kaiMember = ward.members[kaiId];
    if (kaiMember === undefined) throw new Error('missing kai');
    const privateNote = 'Private note text that must never be rendered';
    const wardWithNote: Ward = {
      ...ward,
      members: {
        ...ward.members,
        [kaiId]: { ...kaiMember, note: privateNote },
      },
    };

    const { container } = render(
      <OutOfUnitView board={current} ward={wardWithNote} readOnly={false} onAddToDugout={() => {}} />,
    );

    expect(container.innerHTML).not.toContain(privateNote);
  });
});
