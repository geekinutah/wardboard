import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REF_PATTERN = /^[0-9a-f]{64}\.(jpg|png)$/;

const CONTENT_TYPE: Readonly<Record<'jpg' | 'png', string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
};

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export type PhotoStore = {
  put(bytes: Uint8Array, ext: 'jpg' | 'png'): Promise<string>;
  read(ref: string): Promise<{ bytes: Buffer; contentType: string } | null>;
};

export function createPhotoStore(dataDir: string): PhotoStore {
  const directory = path.join(dataDir, 'photos');

  return {
    async put(bytes: Uint8Array, ext: 'jpg' | 'png'): Promise<string> {
      const hash = createHash('sha256').update(bytes).digest('hex');
      const ref = `${hash}.${ext}`;
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `.tmp-${randomBytes(16).toString('hex')}`);
      await writeFile(temporary, bytes);
      await rename(temporary, path.join(directory, ref));
      return ref;
    },

    async read(ref: string): Promise<{ bytes: Buffer; contentType: string } | null> {
      // Reject before any filesystem call so a bad ref cannot escape the directory.
      const match = REF_PATTERN.exec(ref);
      if (match === null) return null;
      const ext = match[1];
      if (ext !== 'jpg' && ext !== 'png') return null;
      try {
        const bytes = await readFile(path.join(directory, ref));
        return { bytes, contentType: CONTENT_TYPE[ext] };
      } catch (error: unknown) {
        if (isNodeError(error, 'ENOENT')) return null;
        throw error;
      }
    },
  };
}
