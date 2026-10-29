import { describe, expect, it, vi } from 'vitest';
import { photoUrl, uploadPhoto } from './upload.ts';

const REF = `${'cd'.repeat(32)}.png`;

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ),
  );
}

const file = new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' });

describe('upload client', () => {
  it('uploadPhoto posts the file and returns the ref', async () => {
    const fetchImpl = fakeFetch(201, { photoRef: REF });
    await expect(uploadPhoto(file, fetchImpl)).resolves.toEqual({ photoRef: REF });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/api/photos');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(file);
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('content-type')).toBe('image/png');
  });

  it('uploadPhoto maps each refusal to its message', async () => {
    const cases: [number, string][] = [
      [415, 'Choose a JPEG or PNG.'],
      [413, 'That photo is larger than 5 MB.'],
      [400, "That file isn't a readable image."],
      [401, "You don't have permission to upload photos."],
      [403, "You don't have permission to upload photos."],
      [500, 'The photo could not be uploaded.'],
    ];
    for (const [status, message] of cases) {
      await expect(uploadPhoto(file, fakeFetch(status, { error: 'x' }))).rejects.toThrow(
        new Error(message),
      );
    }
  });

  it('uploadPhoto rejects a body without a ref', async () => {
    await expect(uploadPhoto(file, fakeFetch(201, {}))).rejects.toThrow(
      new Error('The photo could not be uploaded.'),
    );
  });

  it('uploadPhoto rejects a network failure', async () => {
    const failing = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('socket secret detail')));
    await expect(uploadPhoto(file, failing)).rejects.toThrow(new Error('The photo could not be uploaded.'));
  });

  it('photoUrl encodes the ref', () => {
    expect(photoUrl('ab.jpg')).toBe('/api/photos/ab.jpg');
    expect(photoUrl('a/b c.jpg')).toBe('/api/photos/a%2Fb%20c.jpg');
  });
});
