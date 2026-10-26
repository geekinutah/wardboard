import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';

describe('gallery route', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders the component gallery at /__gallery', () => {
    window.history.pushState({}, '', '/__gallery');
    render(<App healthClient={() => new Promise(() => undefined)} />);

    expect(screen.getByRole('article', { name: 'Ada Fictional' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Checking server…')).not.toBeInTheDocument();
  });
});
