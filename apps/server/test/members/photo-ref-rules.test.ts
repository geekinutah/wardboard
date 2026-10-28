import { describe, expect, it } from 'vitest';
import { parseMemberPatch } from '../../src/members/index.ts';

const HEX = 'ab'.repeat(32);
const JPG = `${HEX}.jpg`;
const PNG = `${HEX}.png`;
const PHOTO_MESSAGE =
  'photoRef must be a 64-character lowercase sha256 hex with a jpg or png extension';

function message(value: unknown): string {
  const result = parseMemberPatch(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected photoRef to be rejected');
  return result.message;
}

describe('photoRef patch rules', () => {
  it('parseMemberPatch accepts a jpg and a png ref', () => {
    expect(parseMemberPatch({ photoRef: JPG })).toEqual({ ok: true, value: { photoRef: JPG } });
    expect(parseMemberPatch({ photoRef: PNG })).toEqual({ ok: true, value: { photoRef: PNG } });
    expect(parseMemberPatch({ name: '  Ada  ', photoRef: JPG })).toEqual({
      ok: true,
      value: { name: 'Ada', photoRef: JPG },
    });

    expect(message({ photoRef: null })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: 12 })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: '' })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: `${HEX.toUpperCase()}.jpg` })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: `${HEX}.gif` })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: '../x' })).toBe(PHOTO_MESSAGE);
    expect(message({ name: 'Ada', photoRef: null })).toBe(PHOTO_MESSAGE);
    expect(message({ photoRef: `${'a'.repeat(63)}.jpg` })).toBe(PHOTO_MESSAGE);

    const unknown = parseMemberPatch({ photoRef: JPG, needsApproval: true });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toBe('patch has an unknown key');
  });
});
