# B-042: Tags editor and Accepted view have no server/sync path in the app

**Priority:** P1  
**Area:** server channel / web sync / shell integration  
**State:** resolved  
**Found:** 2026-10-28, controller while writing T-039 and T-043  
**Promoted to:** T-086, T-087, T-088, T-089, T-090

## Finding

T-039 (tags editor) and T-043 (accepted view) are standalone components with callback props. They can't be reached in the real app yet:
- The server channel has `createTag`, `renameTag` and `setNeedsApproval` messages, but **no `deleteTag`** message. Core `deleteTag(ward, boards, id)` and `tagUsage` exist. SPEC §6 requires deletion with a usage-count confirmation across Current and every proposal.
- The web `SyncClient` has no methods for `createTag`, `renameTag`, `setNeedsApproval`, `setProposalStatus`, `getProposal` (accepted detail with the frozen summary), or a tag-usage read. It also has no accepted-list read beyond `boards`.
- The calling tag and preference ops (`setCallingTags`, `setCallingPreferences`) exist as operations and can go through `send`.

## Risk

SPEC §6 tag deletion and SPEC §3 accept/reopen with the copyable summary stay unusable in the app until this is wired. Milestone 4 can't close without it.

## Direction

After T-039, T-043 and T-078 are done:
1. Server task: a `deleteTag` message (Editor+, applies core `deleteTag` across Current, baselines and all proposal boards atomically, broadcasts the ward and boards) and a `tagUsage` read. Include auth tests.
2. Sync client methods for the messages above.
3. Shell integration: mount `MemberTagsEditor` in the inspector, `CallingTagsEditor` at group level, `TagLibrary` from Settings or the header, and `AcceptedView` from the status strip / summary.

## Evidence

- `apps/server/src/ws/channel.ts:945-1025` (message types; no `deleteTag`)
- `apps/web/src/sync/client.ts` public methods (`whoami` … `transferAdmin`; none for tags or status)
- `docs/tasks/T-039-tags-affinities-editor.md`, `docs/tasks/T-043-accepted-proposal-view.md` (Out of scope)
