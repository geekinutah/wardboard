const GENERIC = 'The photo could not be uploaded.';

const REFUSALS: Readonly<Record<number, string>> = {
  415: 'Choose a JPEG or PNG.',
  413: 'That photo is larger than 5 MB.',
  400: "That file isn't a readable image.",
  401: "You don't have permission to upload photos.",
  403: "You don't have permission to upload photos.",
};

export function photoUrl(photoRef: string): string {
  return `/api/photos/${encodeURIComponent(photoRef)}`;
}

export async function uploadPhoto(
  file: File,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<{ photoRef: string }> {
  let response: Response;
  try {
    response = await fetchImpl('/api/photos', {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type },
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(GENERIC);
  }
  if (response.status !== 201) {
    throw new Error(REFUSALS[response.status] ?? GENERIC);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(GENERIC);
  }
  if (typeof body === 'object' && body !== null && 'photoRef' in body && typeof body.photoRef === 'string') {
    return { photoRef: body.photoRef };
  }
  throw new Error(GENERIC);
}
