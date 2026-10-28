import type { RequestResult } from '../../sync/protocol.ts';

export function assignPhoto(
  client: { updateMember(memberId: string, patch: { photoRef: string }): Promise<RequestResult> },
  memberId: string,
  photoRef: string,
): Promise<RequestResult> {
  return client.updateMember(memberId, { photoRef });
}
