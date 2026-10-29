import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  addToDugout,
  addToList,
  dugout,
  sequentialIds,
  type Board,
  type MemberId,
  type OperationResult,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { buildFillCandidates, type PhoneFillCandidateRow, type PhonePersonSheetModel } from './model.ts';
import { PhoneFillSheet } from './PhoneFillSheet.tsx';
import { PhonePersonSheet } from './PhonePersonSheet.tsx';

/*
 * Fixture (buildPreviewData, "Spring adjustments"): the dugout is Ari Sample,
 * Jay Storybook (Weekday availability) and Tai Demo (Musical). Chorister
 * (Ward-wide Callings · Music) prefers Musical. Primary Teacher is a list.
 */

function expectOk(result: OperationResult): Board {
  if (!result.ok) throw new Error(result.error.message);
  return result.board;
}

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) throw new Error(`missing member ${name}`);
  return found.id;
}

function vacancyTitled(board: Board, title: string): PositionId {
  const found = Object.values(board.positions)
    .filter((position) => board.assignments[position.assignmentId]?.title === title)
    .find((position) => board.placements[position.id] === undefined);
  if (found === undefined) throw new Error(`missing vacancy ${title}`);
  return found.id;
}

function names(ward: Ward, rows: readonly PhoneFillCandidateRow[]): string[] {
  return rows.map((row) => ward.members[row.memberId as MemberId]?.name ?? row.memberId);
}

describe('buildFillCandidates', () => {
  it('buildFillCandidates lists the dugout in core order with matches', () => {
    const data = buildPreviewData();
    const ward = data.ward;
    // Jo Testwell joins the dugout on purpose and keeps her two callings.
    const jo = memberNamed(ward, 'Jo Testwell');
    const board = expectOk(addToDugout(data.proposal.board, { ward, ids: sequentialIds('t') }, { memberId: jo }));
    const chorister = vacancyTitled(board, 'Chorister');

    const rows = buildFillCandidates(board, ward, chorister);
    expect(rows.map((row) => row.memberId)).toEqual(dugout(board, ward).map((entry) => entry.memberId));
    expect(names(ward, rows)).toEqual(['Ari Sample', 'Jay Storybook', 'Jo Testwell', 'Tai Demo']);

    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('Ari Sample')).toMatchObject({ detail: 'No calling', matchedTagNames: [] });
    expect(byName.get('Jo Testwell')).toMatchObject({
      detail: 'Relief Society Teacher, Nursery Leader',
      matchedTagNames: [],
    });
    // Chorister prefers Musical; Tai carries it. A match never reorders.
    expect(byName.get('Tai Demo')).toMatchObject({ detail: 'No calling', matchedTagNames: ['Musical'] });
  });

  it('buildFillCandidates skips list members already in the list', () => {
    const data = buildPreviewData();
    const ward = data.ward;
    const ari = memberNamed(ward, 'Ari Sample');
    const ctx = { ward, ids: sequentialIds('t') };
    const primaryTeacher = Object.values(data.proposal.board.assignments).find(
      (assignment) => assignment.title === 'Primary Teacher',
    );
    if (primaryTeacher === undefined) throw new Error('missing Primary Teacher');
    // Ari takes one Primary Teacher seat, then joins the dugout on purpose.
    const placed = expectOk(addToList(data.proposal.board, ctx, { memberId: ari, from: null, assignmentId: primaryTeacher.id }));
    const board = expectOk(addToDugout(placed, ctx, { memberId: ari }));
    expect(dugout(board, ward).map((entry) => entry.memberId)).toContain(ari);

    const vacant = vacancyTitled(board, 'Primary Teacher');
    const rows = buildFillCandidates(board, ward, vacant);
    expect(rows.map((row) => row.memberId)).not.toContain(ari);
    expect(names(ward, rows)).toEqual(['Jay Storybook', 'Tai Demo']);

    // A single assignment elsewhere still offers Ari.
    const elsewhere = buildFillCandidates(board, ward, vacancyTitled(board, 'Chorister'));
    expect(elsewhere.map((row) => row.memberId)).toContain(ari);
  });

  it('buildFillCandidates filters by name or matched tag, case-insensitively', () => {
    const data = buildPreviewData();
    const ward = data.ward;
    const board = data.proposal.board;
    const chorister = vacancyTitled(board, 'Chorister');

    expect(names(ward, buildFillCandidates(board, ward, chorister, 'STORY'))).toEqual(['Jay Storybook']);
    expect(names(ward, buildFillCandidates(board, ward, chorister, 'musi'))).toEqual(['Tai Demo']);
    // Tags the position doesn't prefer are not searched.
    expect(buildFillCandidates(board, ward, chorister, 'weekday')).toEqual([]);
    expect(names(ward, buildFillCandidates(board, ward, chorister, '   '))).toEqual([
      'Ari Sample',
      'Jay Storybook',
      'Tai Demo',
    ]);
    expect(names(ward, buildFillCandidates(board, ward, chorister, 'a'))).toEqual([
      'Ari Sample',
      'Jay Storybook',
      'Tai Demo',
    ]);
  });

  it('buildFillCandidates returns nothing for an unknown position', () => {
    const data = buildPreviewData();
    expect(buildFillCandidates(data.proposal.board, data.ward, 'p-missing')).toEqual([]);
  });
});

const rows: readonly PhoneFillCandidateRow[] = [
  { memberId: 'm-ari', name: 'Ari Sample', detail: 'No calling', matchedTagNames: [] },
  { memberId: 'm-tai', name: 'Tai Demo', detail: 'No calling', matchedTagNames: ['Musical'] },
];

describe('PhoneFillSheet', () => {
  it('fill sheet shows empty and no-match states', () => {
    const props = {
      title: 'Chorister',
      orgLabel: 'Ward-wide Callings · Music',
      onQueryChange: vi.fn(),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<PhoneFillSheet {...props} candidates={[]} query="" />);
    const dialog = screen.getByRole('dialog', { name: 'Fill Chorister' });
    expect(dialog).toHaveTextContent('Ward-wide Callings · Music');
    expect(dialog).toHaveTextContent('Dugout');
    expect(screen.getByText('No one in the dugout.')).toBeInTheDocument();
    expect(screen.queryByText('No matching people.')).not.toBeInTheDocument();

    rerender(<PhoneFillSheet {...props} candidates={[]} query="zz" />);
    expect(screen.getByText('No matching people.')).toBeInTheDocument();
    expect(screen.queryByText('No one in the dugout.')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a person' })).toHaveValue('zz');

    rerender(<PhoneFillSheet {...props} candidates={rows} query="" />);
    expect(screen.queryByText('No one in the dugout.')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching people.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ari Sample, No calling' })).toBeInTheDocument();
    const tai = screen.getByRole('button', { name: 'Tai Demo, No calling, Matches Musical' });
    expect(tai).toHaveTextContent('Matches Musical');
  });

  it('fill sheet calls back with the chosen member and cancels on Escape', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const onQueryChange = vi.fn();
    render(
      <PhoneFillSheet
        title="Chorister"
        orgLabel="Ward-wide Callings · Music"
        candidates={rows}
        query=""
        onQueryChange={onQueryChange}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Tai Demo, No calling, Matches Musical' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('m-tai');

    await user.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'T');
    expect(onQueryChange).toHaveBeenLastCalledWith('T');

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

const model: PhonePersonSheetModel = {
  memberId: 'm-jo',
  name: 'Jo Testwell',
  categoryLabel: 'Adult',
  tagNames: [],
  needsApproval: false,
  externalCallings: [],
  callings: [],
  inExplicitDugout: false,
};

describe('PhonePersonSheet profile', () => {
  it('person sheet hides Profile without onOpenProfile', async () => {
    const user = userEvent.setup();
    const common = {
      model,
      boardName: 'Spring adjustments',
      editable: true,
      onStartMove: vi.fn(),
      onRelease: vi.fn(),
      onAddToDugout: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<PhonePersonSheet {...common} />);
    expect(screen.queryByRole('button', { name: 'Profile, note & photo' })).not.toBeInTheDocument();

    const onOpenProfile = vi.fn();
    rerender(<PhonePersonSheet {...common} onOpenProfile={onOpenProfile} />);
    await user.click(screen.getByRole('button', { name: 'Profile, note & photo' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });
});
