import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonCard } from './PersonCard.tsx';

describe('PersonCard portrait', () => {
  it('card shows the portrait when a photo URL is given', () => {
    render(<PersonCard name="Ada Lovelace" callingTitle="Organist" photoUrl="/api/photos/a.png" />);
    const card = screen.getByRole('article', { name: 'Ada Lovelace' });
    const img = card.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/api/photos/a.png');
    expect(img).toHaveClass('wb-avatar', 'wb-avatar-photo');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('alt', '');
    expect(card).not.toHaveTextContent('AL');
  });

  it('card shows initials without a photo URL', () => {
    const { rerender } = render(<PersonCard name="Ada Lovelace" photoUrl={null} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('article', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
    rerender(<PersonCard name="Ada Lovelace" />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('article', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
    rerender(<PersonCard name="Ada Lovelace" photoUrl="" />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('article', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
  });

  it('card falls back to initials when the portrait fails', () => {
    render(<PersonCard name="Ada Lovelace" photoUrl="/api/photos/a.png" />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('article', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
  });

  it('a new URL retries after a failure', () => {
    const { rerender } = render(<PersonCard name="Ada Lovelace" photoUrl="/api/photos/a.png" />);
    fireEvent.error(document.querySelector('img') as HTMLImageElement);
    expect(document.querySelector('img')).toBeNull();
    rerender(<PersonCard name="Ada Lovelace" photoUrl="/api/photos/b.png" />);
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/photos/b.png');
  });

  it('removed cards keep initials', () => {
    render(<PersonCard name="Ada Lovelace" removed photoUrl="/api/photos/a.png" />);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body).toHaveTextContent('AL');
  });
});
