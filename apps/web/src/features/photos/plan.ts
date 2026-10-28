export type PhotoMember = {
  readonly id: string;
  readonly name: string;
  readonly photoRef: string | null;
};

export function planPhotoBatch(
  members: readonly PhotoMember[],
  incoming: readonly { readonly memberId: string }[],
):
  | { ok: true; apply: readonly string[]; compare: readonly string[] }
  | { ok: false; code: 'unknown_member' | 'duplicate_member' } {
  const seen = new Set<string>();
  for (const item of incoming) {
    if (seen.has(item.memberId)) return { ok: false, code: 'duplicate_member' };
    seen.add(item.memberId);
  }

  const byId = new Map(members.map((member) => [member.id, member]));
  const apply: string[] = [];
  const compare: string[] = [];
  for (const item of incoming) {
    const member = byId.get(item.memberId);
    if (member === undefined) return { ok: false, code: 'unknown_member' };
    if (member.photoRef === null) apply.push(item.memberId);
    else compare.push(item.memberId);
  }
  return { ok: true, apply, compare };
}
