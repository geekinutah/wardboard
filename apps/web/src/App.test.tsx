import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { HealthClient, HealthResponse } from './health.ts';

function jsonResponse(status: number, body: unknown): HealthResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function clientReturning(response: HealthResponse): HealthClient {
  return () => Promise.resolve(response);
}

describe('App shell', () => {
  it('shows the brand in a header landmark', () => {
    render(<App healthClient={() => new Promise<HealthResponse>(() => undefined)} />);

    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('WardBoard')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows Checking server while health is pending', () => {
    render(<App healthClient={() => new Promise<HealthResponse>(() => undefined)} />);

    const main = screen.getByRole('main');
    expect(within(main).getByText('Checking server…')).toBeInTheDocument();
    expect(screen.queryByText('Server: ok')).not.toBeInTheDocument();
    expect(screen.queryByText('Server unreachable')).not.toBeInTheDocument();
  });

  it('shows Server: ok when health is ok', async () => {
    render(<App healthClient={clientReturning(jsonResponse(200, { status: 'ok' }))} />);

    expect(await screen.findByText('Server: ok')).toBeInTheDocument();
    expect(screen.queryByText('Checking server…')).not.toBeInTheDocument();
  });

  it('shows Server unreachable on network error', async () => {
    const client: HealthClient = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<App healthClient={client} />);

    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
    expect(screen.queryByText('Checking server…')).not.toBeInTheDocument();
  });

  it('shows Server unreachable on a non-ok response or unexpected body', async () => {
    const cases: { name: string; response: HealthResponse }[] = [
      { name: '500 with ok body', response: jsonResponse(500, { status: 'ok' }) },
      { name: '200 with status down', response: jsonResponse(200, { status: 'down' }) },
      { name: '200 with non-object body', response: jsonResponse(200, 'ok') },
      { name: '200 with null body', response: jsonResponse(200, null) },
      {
        name: '200 with invalid JSON',
        response: { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token')) },
      },
    ];

    for (const { name, response } of cases) {
      const { unmount } = render(<App healthClient={clientReturning(response)} />);

      expect(await screen.findByText('Server unreachable'), name).toBeInTheDocument();
      expect(screen.queryByText('Server: ok'), name).not.toBeInTheDocument();
      unmount();
    }
  });

  it('default health client calls /api/health', async () => {
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchStub);

    render(<App />);

    expect(await screen.findByText('Server: ok')).toBeInTheDocument();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('default health client maps a failing response to Server unreachable', async () => {
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{"error":"internal_error"}', { status: 500 })),
    );
    vi.stubGlobal('fetch', fetchStub);

    render(<App />);

    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
    expect(fetchStub).toHaveBeenCalledWith('/api/health', expect.anything());
  });
});
