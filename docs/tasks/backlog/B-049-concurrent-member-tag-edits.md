# B-049: Concurrent member tag edits can lose one editor's change

**Priority:** P2  
**Area:** server members / web sync  
**State:** candidate  
**Found:** 2026-10-28, T-089 round 2 implementer (e2e debugging)  
**Promoted to:** —

## Finding

`updateMember` takes a whole `tagIds` list and replaces the member's tags. The web client (T-088 `MemberTagsSection`) builds that list from its local ward. If two editors add different tags to the same member at nearly the same time, each sends `[...theirView, newTag]`, and the second write silently drops the first editor's tag. The same applies to notes, but tags are the likely collision case in a live meeting.

## Risk

The app is collaborative by design (SPEC §10: phone and laptop edits during the same meeting). A dropped tag is silent: nobody is told it was lost. It was reproduced in the e2e suite, where concurrent repeats tagging the same member left "Used" at 0.

## Direction

Either add `addMemberTag` / `removeMemberTag` messages (set semantics, applied by the server to the current ward), or make `updateMember` conditional on an expected prior `tagIds` and refuse it as stale (the client then retries on the fresh ward). Prefer the add/remove operations; they never conflict.

## Evidence

- T-089 round 2 implementer notes (docs/tasks/evidence/T-089.md): WS frame log with member m-0001 tagged from desktop repeats r3 and r4.
- `apps/web/src/shell/TagsWiring.tsx` (`onSetTags` → `client.updateMember(id, { tagIds })`)
