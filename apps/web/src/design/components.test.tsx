import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { PersonCard } from './PersonCard.tsx';
import { RemovedCard } from './RemovedCard.tsx';
import { VacancySlot } from './VacancySlot.tsx';

const releaseMark = '\u2212';

describe('design components', () => {
  it('PersonCard has the member name as its accessible name', () => {
    render(
      <PersonCard name="Ada Fictional" callingTitle="Relief Society teacher" tags={['Weekday']} />,
    );

    expect(screen.getByRole('article', { name: 'Ada Fictional' })).toBeInTheDocument();
  });

  it('PersonCard shows initials placeholder', () => {
    const { rerender } = render(<PersonCard name="Ada Fictional" />);
    expect(screen.getByText('AF')).toBeInTheDocument();

    rerender(<PersonCard name="Cleo" />);
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('AF')).not.toBeInTheDocument();

    rerender(<PersonCard name="  Ada   Fictional  " />);
    expect(screen.getByText('AF')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Ada Fictional' })).toBeInTheDocument();
  });

  it('PersonCard needs approval is text, not only color', () => {
    render(<PersonCard name="Ben Example" needsApproval />);

    const label = screen.getByText('Needs approval');
    expect(label).toBeInTheDocument();
    expect(label.querySelector('svg')).not.toBeNull();
  });

  it('PersonCard proposed and release are labeled', () => {
    const { rerender } = render(
      <PersonCard name="Dana Sample" callingTitle="Elders Quorum secretary" proposed />,
    );
    expect(screen.getByText('+ Proposed')).toBeInTheDocument();

    rerender(<PersonCard name="Erin Placeholder" callingTitle="Ward pianist" release />);
    expect(screen.getByText(releaseMark)).toBeInTheDocument();
    const title = screen.getByText('Ward pianist');
    expect(title.closest('s, del')).not.toBeNull();
  });

  it('PersonCard removed renders RemovedCard', () => {
    render(<PersonCard name="Finn Invented" callingTitle="Music leader" removed />);

    expect(screen.getByRole('article', { name: 'Finn Invented' })).toBeInTheDocument();
    expect(screen.getByText('Removed from Current')).toBeInTheDocument();
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
  });

  it('removed combined with proposed is textual and removed wins', () => {
    render(<PersonCard name="Greta Nobody" callingTitle="Chorister" removed proposed />);

    const article = screen.getByRole('article', { name: 'Greta Nobody' });
    expect(screen.getByText('Removed from Current')).toBeInTheDocument();
    expect(screen.getByText('+ Proposed')).toBeInTheDocument();
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
    expect(screen.queryByText('POSITION REMOVED')).not.toBeInTheDocument();
    expect(article).toHaveClass('wb-removed');
    expect(article).not.toHaveClass('wb-person-proposed');
  });

  it('empty tags list renders no list element', () => {
    const { rerender } = render(<PersonCard name="Ada Fictional" tags={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    rerender(<PersonCard name="Ada Fictional" tags={['Teaching']} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Teaching')).toBeInTheDocument();
  });

  it('VacancySlot says Vacant', () => {
    render(<VacancySlot title="Secretary" />);

    expect(screen.getByText('Vacant')).toBeInTheDocument();
    expect(screen.getByText('Secretary')).toBeInTheDocument();
    const slot = screen.getByRole('article');
    expect(slot).toHaveAccessibleName(/Vacant/);
    expect(slot).toHaveAccessibleName(/Secretary/);
  });

  it('RemovedCard member vs position labels', () => {
    const { rerender } = render(<RemovedCard name="Finn Invented" />);
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
    expect(screen.getByText('Removed from Current')).toBeInTheDocument();
    expect(screen.queryByText('POSITION REMOVED')).not.toBeInTheDocument();
    expect(screen.queryByText('Position removed from Current')).not.toBeInTheDocument();

    rerender(<RemovedCard name="Hana Sample" kind="position" />);
    expect(screen.getByText('POSITION REMOVED')).toBeInTheDocument();
    expect(screen.getByText('Position removed from Current')).toBeInTheDocument();
    expect(screen.queryByText('REMOVED')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed from Current')).not.toBeInTheDocument();
  });

  it('Chip variant text carries meaning', () => {
    const cases = [
      ['tag', 'Teaching'],
      ['proposed', '+ Proposed'],
      ['release', releaseMark],
      ['needs-approval', 'Needs approval'],
      ['vacancy', 'Vacant'],
    ] as const;

    for (const [variant, label] of cases) {
      const { unmount } = render(<Chip variant={variant} label={label} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('Button is a real button with type=button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Button disabled does not fire', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
