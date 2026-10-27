import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { Gallery } from './Gallery.tsx';

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

  it('gallery canvas demo shows four org tiles and zoom controls', () => {
    render(<Gallery />);

    expect(screen.getByRole('region', { name: 'Canvas' })).toBeInTheDocument();
    for (const name of ['Relief Society', 'Primary', 'Sunday School', 'Elders Quorum']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-zoom-target="org:relief-society"]')).not.toBeNull();
    expect(document.querySelector('[data-zoom-target="org:primary"]')).not.toBeNull();
    expect(document.querySelector('[data-zoom-target="org:sunday-school"]')).not.toBeNull();
    expect(document.querySelector('[data-zoom-target="org:elders-quorum"]')).not.toBeNull();
    expect(screen.getByText('5 vacant')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Zoom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit ward' })).toBeInTheDocument();
    expect(document.querySelector('.wb-canvas-level')).toHaveTextContent('Ward');
    expect(document.querySelector('.wb-canvas-level')).toHaveAttribute('aria-live', 'polite');
  });
});
