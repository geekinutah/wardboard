import { describe, expect, it } from 'vitest';
import { postImportPreview, postImportReplace, readReportFiles, type ImportFetch } from './client.ts';
import type { ImportPreview, ImportResolution } from './plan.ts';

const pdfs = {
  organizations: 'JVBERg==',
  withoutCallings: 'AQID',
  outOfUnit: '////',
};

const preview: ImportPreview = {
  decisions: [],
  absent: [],
  duplicates: [],
  inconsistentReports: false,
  returning: [],
  needsCategory: [],
  unfamiliar: [],
  keptPositions: 1,
  matchedPositions: 2,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function header(headers: HeadersInit | undefined, name: string): string | null {
  if (headers === undefined) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found === undefined ? null : found[1];
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('expected a JSON string body');
  return body;
}

describe('import client', () => {
  it('preview posts the three pdf fields', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: ImportFetch = (input, init) => {
      calls.push({ url: requestUrl(input), init });
      return Promise.resolve(jsonResponse(200, preview));
    };

    const result = await postImportPreview(fetchImpl, pdfs);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/import/preview');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect(header(calls[0]?.init?.headers, 'content-type')).toMatch(/application\/json/i);
    const previewBody = jsonBody(calls[0]?.init?.body);
    expect(previewBody).not.toContain('data:');
    expect(JSON.parse(previewBody)).toEqual(pdfs);
    expect(result).toEqual({ ok: true, preview });
  });

  it('replace sends the version and the resolutions', async () => {
    const resolutions: Record<string, ImportResolution> = {
      'lark, june': { action: 'match', memberId: 'm-june' },
      'pineda, otto': { action: 'new' },
    };
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: ImportFetch = (input, init) => {
      calls.push({ url: requestUrl(input), init });
      return Promise.resolve(jsonResponse(200, { replaced: true, matched: 2, created: 3, removed: 1 }));
    };

    const result = await postImportReplace(fetchImpl, {
      ...pdfs,
      expectedVersion: 3,
      resolutions,
    });

    expect(calls[0]?.url).toBe('/api/import/replace');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect(header(calls[0]?.init?.headers, 'content-type')).toMatch(/application\/json/i);
    const replaceBody = jsonBody(calls[0]?.init?.body);
    expect(replaceBody).not.toContain('data:');
    expect(JSON.parse(replaceBody)).toEqual({
      ...pdfs,
      expectedVersion: 3,
      resolutions,
    });
    expect(result).toEqual({ ok: true, matched: 2, created: 3, removed: 1 });
  });

  it('a forbidden preview is not a preview', async () => {
    for (const status of [401, 403]) {
      const fetchImpl: ImportFetch = () =>
        Promise.resolve(jsonResponse(status, { error: 'forbidden', decisions: [] }));
      const result = await postImportPreview(fetchImpl, pdfs);
      expect(result).toEqual({ ok: false, code: 'forbidden' });
      expect(result).not.toHaveProperty('preview');
      expect(result).not.toHaveProperty('decisions');
    }
  });

  it('a stale replace names the current version', async () => {
    const fetchImpl: ImportFetch = () =>
      Promise.resolve(jsonResponse(409, { error: 'stale', currentVersion: 4 }));

    const result = await postImportReplace(fetchImpl, {
      ...pdfs,
      expectedVersion: 3,
      resolutions: {},
    });

    expect(result).toEqual({ ok: false, code: 'stale', currentVersion: 4 });
  });

  it('an offline preview is offline', async () => {
    const thrown: ImportFetch = () => {
      throw new Error('socket hang up');
    };
    const rejected: ImportFetch = () => Promise.reject(new Error('failed to fetch'));

    expect(await postImportPreview(thrown, pdfs)).toEqual({ ok: false, code: 'offline' });
    expect(await postImportPreview(rejected, pdfs)).toEqual({ ok: false, code: 'offline' });
  });

  it('a too-large preview is too_large', async () => {
    const fetchImpl: ImportFetch = () =>
      Promise.resolve(jsonResponse(413, { error: 'too_large', decisions: [] }));

    const result = await postImportPreview(fetchImpl, pdfs);

    expect(result).toEqual({ ok: false, code: 'too_large' });
    expect(result).not.toHaveProperty('preview');
  });

  it('files become base64 without a data url', async () => {
    const organizations = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xfa]);
    const withoutCallings = new Uint8Array([1, 2, 3]);
    const outOfUnit = new Uint8Array([255, 254, 253, 0]);

    const result = await readReportFiles({
      organizations: new File([organizations], 'organizations.pdf', { type: 'application/pdf' }),
      withoutCallings: new File([withoutCallings], 'without.pdf', { type: 'application/pdf' }),
      outOfUnit: new File([outOfUnit], 'out.pdf', { type: 'application/pdf' }),
    });

    expect(result).toEqual({
      organizations: Buffer.from(organizations).toString('base64'),
      withoutCallings: Buffer.from(withoutCallings).toString('base64'),
      outOfUnit: Buffer.from(outOfUnit).toString('base64'),
    });
    expect(result.organizations.startsWith('data:')).toBe(false);
    expect(result.withoutCallings.startsWith('data:')).toBe(false);
    expect(result.outOfUnit.startsWith('data:')).toBe(false);
  });
});
