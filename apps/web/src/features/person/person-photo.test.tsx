import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { memberId, type Board, type Member, type Ward } from '@wardboard/core';
import { PersonInspector } from './PersonInspector.tsx';
import { buildPreviewData } from '../../preview/data.ts';

const REF = `${'ef'.repeat(32)}.png`;
const data = buildPreviewData();

function withPhoto(ward: Ward, name: string, photoRef: string | null): { ward: Ward; member: Member } {
  const found = Object.values(ward.members).find((m) => m.name === name);
  if (found === undefined) throw new Error(`member ${name} not found`);
  const member = { ...found, photoRef };
  return { ward: { ...ward, members: { ...ward.members, [member.id]: member } }, member };
}

function show(ward: Ward, member: Member, board: Board = data.current) {
  return render(
    <PersonInspector
      board={board}
      ward={ward}
      memberId={memberId(member.id)}
      readOnly={false}
      onOpenNotes={vi.fn()}
      onAddToDugout={vi.fn()}
    />,
  );
}

describe('person inspector portrait', () => {
  it('inspector shows the portrait when the member has one', () => {
    const { ward, member } = withPhoto(data.ward, 'Jo Testwell', REF);
    show(ward, member);
    const img = screen.getByRole('img', { name: 'Portrait of Jo Testwell' });
    expect(img).toHaveAttribute('src', `/api/photos/${REF}`);
    expect(screen.queryByText('JT')).not.toBeInTheDocument();
  });

  it('inspector shows initials without a photo', () => {
    const { ward, member } = withPhoto(data.ward, 'Jo Testwell', null);
    show(ward, member);
    expect(screen.queryByRole('img', { name: /Portrait of/ })).not.toBeInTheDocument();
    expect(screen.getByText('JT')).toBeInTheDocument();
  });

  it('inspector falls back to initials when the portrait fails to load', () => {
    const { ward, member } = withPhoto(data.ward, 'Jo Testwell', REF);
    show(ward, member);
    fireEvent.error(screen.getByRole('img', { name: 'Portrait of Jo Testwell' }));
    expect(screen.queryByRole('img', { name: /Portrait of/ })).not.toBeInTheDocument();
    expect(screen.getByText('JT')).toBeInTheDocument();
  });
});
