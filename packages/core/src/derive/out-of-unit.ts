import { deepFreeze } from '../model/freeze.ts';
import type { MemberId } from '../model/ids.ts';
import type { ExternalCalling, Ward } from '../model/types.ts';
import { compareMembers } from './views.ts';

export interface OutOfUnitEntry {
  readonly memberId: MemberId;
  readonly callings: readonly ExternalCalling[];
}

/**
 * Current members who hold an outside calling, in dugout order (case-insensitive
 * name, then id). Profile data, so it does not depend on a board. SPEC §4, §14.
 */
export function outOfUnitMembers(ward: Ward): readonly OutOfUnitEntry[] {
  const selected = Object.values(ward.members).filter(
    (member) => member.removedDate === null && member.externalCallings.length > 0,
  );
  selected.sort(compareMembers);
  return deepFreeze(
    selected.map((member) => ({
      memberId: member.id,
      callings: member.externalCallings.slice(),
    })),
  );
}
