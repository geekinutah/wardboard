import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { proposalDiff } from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { buildPreviewData } from './data.ts';
import { PreviewApp } from './PreviewApp.tsx';
import type { PreviewData } from './types.ts';
import { Root } from '../main.tsx';

describe('preview data', () => {
  test('preview data proposal differs from its baseline', () => {
    const data = buildPreviewData();
    const diff = proposalDiff(data.proposal);
    expect(diff.callings.length).toBeGreaterThanOrEqual(1);
    expect(diff.releases.length).toBeGreaterThanOrEqual(1);
    expect(diff.addedPositions.length).toBeGreaterThanOrEqual(1);
  });

  test('preview data is deterministic', () => {
    const d1 = buildPreviewData();
    const d2 = buildPreviewData();
    expect(d1).toEqual(d2);
  });

  test('preview data current is untouched', () => {
    const fixture = buildFixtureWard();
    const data = buildPreviewData();
    expect(data.current).toEqual(fixture.current);
    expect(data.ward).toEqual(fixture.ward);
  });

  test('builder throws when a fixture operation fails', () => {
    expect(() =>
      buildPreviewData({
        steps: [
          () => ({
            ok: false,
            error: { code: 'invalid_operation', message: 'injected simulated error' },
          }),
        ],
      }),
    ).toThrow('injected simulated error');
  });
});

describe('PreviewApp', () => {
  test('index lists previews sorted and handles none', () => {
    // Empty module map
    const { unmount } = render(<PreviewApp pathname="/__preview" modules={{}} />);
    expect(screen.getByRole('heading', { name: 'Previews', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('No previews yet.')).toBeInTheDocument();
    unmount();

    // Injected sorted modules
    const modules = {
      'features/zebra/preview.tsx': { title: 'Zebra Title', render: () => <div>Zebra View</div> },
      'features/alpha/preview.tsx': { title: 'Alpha Title', render: () => <div>Alpha View</div> },
    };
    render(<PreviewApp pathname="/__preview" modules={modules} />);
    expect(screen.getByRole('heading', { name: 'Previews', level: 1 })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Alpha Title');
    expect(links[0]).toHaveAttribute('href', '/__preview/alpha');
    expect(links[1]).toHaveTextContent('Zebra Title');
    expect(links[1]).toHaveAttribute('href', '/__preview/zebra');
  });

  test('known name renders the module with the data', () => {
    const renderFn = vi.fn((data: PreviewData) => (
      <div>Custom Render: {Object.values(data.ward.members)[0]?.name}</div>
    ));
    const modules = {
      'features/alpha/preview.tsx': {
        title: 'Alpha Title',
        render: renderFn,
      },
    };
    render(<PreviewApp pathname="/__preview/alpha" modules={modules} />);
    expect(renderFn).toHaveBeenCalledTimes(1);
    const call = renderFn.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error('Expected renderFn to have been called');
    const passedData = call[0];
    expect(passedData).toBeDefined();
    expect(passedData.ward).toBeDefined();
    expect(passedData.proposal).toBeDefined();
    expect(screen.getByText(/Custom Render: Ada Fictional/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All previews' })).toHaveAttribute('href', '/__preview');
  });

  test('unknown name shows the not-found message', () => {
    expect(() => {
      render(<PreviewApp pathname="/__preview/unknown-preview" modules={{}} />);
    }).not.toThrow();
    expect(screen.getByText('No preview named unknown-preview.')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: 'Back to index' });
    expect(backLink).toHaveAttribute('href', '/__preview');
  });
});

describe('main routing', () => {
  test('non-preview paths render App', async () => {
    render(<Root pathname="/" />);
    expect(await screen.findByText('WardBoard')).toBeInTheDocument();
  });
});
