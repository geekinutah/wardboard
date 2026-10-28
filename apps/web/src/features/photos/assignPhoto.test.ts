import { describe, expect, it, vi } from 'vitest';
import type { RequestResult } from '../../sync/protocol.ts';
import { assignPhoto } from './assignPhoto.ts';

describe('assignPhoto', () => {
  it('assignPhoto sends only photoRef', async () => {
    const ref = `${'ab'.repeat(32)}.jpg`;
    const ok = { ok: true } as RequestResult;
    const updateMember = vi.fn<(memberId: string, patch: { photoRef: string }) => Promise<RequestResult>>(() =>
      Promise.resolve(ok),
    );
    await expect(assignPhoto({ updateMember }, 'm-ada', ref)).resolves.toEqual({ ok: true });
    expect(updateMember).toHaveBeenCalledTimes(1);
    const call = updateMember.mock.calls[0];
    if (call === undefined) throw new Error('updateMember was not called');
    expect(call[0]).toBe('m-ada');
    expect(call[1]).toEqual({ photoRef: ref });
    expect(Object.keys(call[1])).toEqual(['photoRef']);
  });
});
