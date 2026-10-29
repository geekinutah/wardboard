# T-100: Portraits on cards, dugout and presentation

**Milestone:** 6 — Import and photos
**Depends on:** T-093 (portrait in the desktop inspector; `photoUrl` in `features/photos/upload.ts`), T-027 (photo storage). Both done.
- Runs in parallel with T-094 (phone sheets) and T-097 (import in Settings). It must not edit any file they list: not `shell/PhoneApp.tsx`, `shell/PhoneEditing.tsx`, `shell/SettingsRoute.tsx`, `features/phone-*/**`, `features/dnd/**`, `features/import/**`, or `features/settings/**`.

**Spec refs:** SPEC.md §6 ("A person card includes name, optional photo, youth/adult distinction, current callings, short tags"; "All tags and photos are shown in presentation mode"). §4 (the zoomed-out ward view shows leadership photos rather than a wall of every member's picture). §7/§14 (`photoRef` is ward-wide shared profile data, shown across Current and all proposals; a placeholder when there is no photo). §10 (presentation mode: large text, leadership photos). Artboards `docs/design/ui-canvas/Main.dc.html`, `OrgDetail.dc.html`, `Zoom.dc.html`, `Presentation.dc.html`, `Aaronic.dc.html`.

## Goal
On the desktop and TV screens, wherever a member's initials avatar is drawn today on a person card, a leader slot or presentation mode, a member with a stored portrait shows that portrait instead, at the same size and shape. Members without a portrait keep the initials. A new portrait appears on every client without reloading, because it comes from the synced ward.

## Design decisions (binding)

### Shared avatar (`apps/web/src/design/`)
- `PersonContent` and `PersonCard` take a new optional prop `photoUrl?: string | null | undefined` (default `null`). `PersonCard` passes it to `PersonContent`.
- In `PersonContent`, when `photoUrl` is a non-empty string and the image has not failed, render `<img className="wb-avatar wb-avatar-photo" src={photoUrl} alt="" aria-hidden="true" />` in place of the initials span. The card's `aria-label` already names the person, so the image is decorative. `onError` falls back to the initials span for that URL. A different URL later tries again.
- `.wb-avatar-photo` in `components.css`: same box as `.wb-avatar`, `object-fit: cover`, no background color. A muted avatar (`mutedAvatar`) and `RemovedCard` keep initials: removed members are not shown with a portrait. `RemovedCard.tsx` does not change.
- `design/` never imports from `features/`. Callers build the URL.

### Callers
Each caller computes `member.photoRef === null ? null : photoUrl(member.photoRef)` with `photoUrl` from `features/photos/upload.ts` and passes it:
- `features/org-view/OrganizationView.tsx` — every `PersonCard` for an occupied position.
- `features/group-view/GroupDetail.tsx` — every `PersonCard` (not `RemovedCard`).
- `features/aaronic/AaronicView.tsx` — every `PersonCard`, and the linked bishop avatar (`LinkedBishop`) through the same img/fallback rule (a small local helper or `PersonContent`'s rule, without changing its look when there is no photo).
- `features/dugout/DugoutPanel.tsx` — each dugout row's `PersonCard`. The row CSS that paints initials through `::after` (`dugout.css`) must not cover or tint the portrait; adjust `dugout.css` only for `.wb-avatar-photo`.
- `features/ward-overview/WardOverview.tsx` — each leader slot's avatar (leadership photos at level 1).
- `features/presentation/Presentation.tsx` — each leader's `wb-presentation-avatar`, with the proposed-leader ring kept around the portrait.
For the four non-card avatars (Aaronic linked bishop, ward overview leader, presentation leader), use `<img … alt="" aria-hidden="true">` with the existing avatar class plus a `-photo` modifier and the same `onError` fallback.

Not in this task: search results, the drag ghost, the desktop inspector (T-093 did it), and every phone screen.

## Scope
May change:
- `apps/web/src/design/PersonContent.tsx`, `PersonCard.tsx` (the `photoUrl` prop only), `components.css` (`.wb-avatar-photo` only)
- `apps/web/src/design/person-photo.test.tsx` (new)
- `apps/web/src/features/org-view/OrganizationView.tsx`, `features/group-view/GroupDetail.tsx`, `features/aaronic/AaronicView.tsx` (+ `aaronic.css`), `features/dugout/DugoutPanel.tsx` (+ `dugout.css`), `features/ward-overview/WardOverview.tsx` (+ `ward-overview.css`), `features/presentation/Presentation.tsx` (+ `presentation.css`) — portrait wiring and its styles only
- `apps/web/src/features/photos/portraits.test.tsx` (new; caller tests)
- `apps/web/e2e/portraits.spec.ts`, `apps/web/e2e/gui/portraits.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture), `RemovedCard.tsx`, `features/photos/upload.ts` and the other photos files, `features/person/**`, `features/search/**`, `features/dnd/**`, all `features/phone-*/**`, `apps/web/src/shell/**`, `apps/web/src/sync/**`, `apps/server/**`, `packages/**`, `scripts/**`, `playwright.config.ts`, `package.json`, `docs/gui-verification.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/design src/features/photos src/features/org-view src/features/group-view src/features/aaronic src/features/dugout src/features/ward-overview src/features/presentation src/shell` | every new test below passes; every existing test in those paths passes unmodified |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/portraits.spec.ts` | passes on desktop-chromium and tv-chromium; phone projects skip with the reason `Phone portraits are out of scope for T-100` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/portraits/` has `ward-overview`, `organization`, `group-detail`, `dugout`, `presentation` PNGs for `desktop-chromium` and `presentation` for `tv-chromium` |
| 4 | Mutation | in a disposable worktree at the candidate, make `PersonContent` ignore `photoUrl`, then run check 1 | `card shows the portrait when a photo URL is given` and `organization cards show stored portraits` fail; remove the worktree |
| 5 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`design/person-photo.test.tsx`:

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `card shows the portrait when a photo URL is given` | `PersonCard` with `photoUrl="/api/photos/a.png"` renders an `img` with that `src` and no initials text; the card's accessible name is still the person's name | prop ignored |
| `card shows initials without a photo URL` | `null` and omitted both render the initials span and no `img` | empty img |
| `card falls back to initials when the portrait fails` | firing `error` on the img shows the initials | broken-image icon |
| `a new URL retries after a failure` | after an error, rerendering with a different URL shows an `img` again | failure state never resets |
| `removed cards keep initials` | `PersonCard removed` with a `photoUrl` shows no `img` | portrait on a removed member |

`features/photos/portraits.test.tsx` (render each view with fixture data from `buildPreviewData()` where one member, and one leader, has a `photoRef`):

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `organization cards show stored portraits` | the member's card in `OrganizationView` has an img `src` `/api/photos/<ref>`; another member's card has initials | caller not wired |
| `group detail cards show stored portraits` | same for `GroupDetail` | caller not wired |
| `Aaronic cards and the linked bishop show stored portraits` | same for an `AaronicView` card and the linked bishop | one of the two missing |
| `dugout rows show stored portraits` | a dugout row for the member has the img | dugout skipped |
| `ward overview leaders show stored portraits` | the leader slot has the img; a leader without a photo keeps initials | leader avatar skipped |
| `presentation leaders show stored portraits` | the presentation leader has the img; the proposed ring class stays on a proposed leader | ring lost; skipped |
| `a ward update changes the portrait` | rerendering a view with a ward whose member `photoRef` changed updates the `src` | caching the first ref |

## Edge cases (each needs a test)
Covered above: no photo, failed load, retry with a new URL, removed member, proposed leader, ward update.

## e2e (`apps/web/e2e/portraits.spec.ts`)
desktop-chromium and tv-chromium at `/?layout=desktop`. Pick one fictional leader shown on the ward overview whose initials are **not** asserted by any existing spec or capture (grep `e2e/` for the name and initials first, and for the members `person-photo.spec.ts` uses) and name them in a comment. Generate a tiny valid PNG in the spec with Node.
1. Select the leader, upload the PNG through the inspector's `Upload photo for {name}` input (first photo, no comparison).
2. A second page that was already open at `/` shows the leader's portrait on the ward overview without reloading; its image has loaded (`naturalWidth > 0`).
3. Open the leader's organization and group: the card shows the portrait.
4. Open presentation mode: the leader's portrait shows.
5. A member without a photo still shows initials.

## GUI verification
Required (`docs/gui-verification.md`) at `/`, on desktop-chromium (ward overview, organization, group detail, dugout, presentation) and tv-chromium (presentation). Compare with the artboards named above. Fail on: a stretched or squashed portrait, a portrait a different size from the initials avatars beside it, the dugout initials or tint painted over a portrait, the proposed-leader ring missing, or a card that changes height with a portrait.

## Human checks
- Office TV in presentation mode: with a real-sized fictional placeholder portrait on two leaders, confirm the photos read clearly from across the room and look right beside the initials of leaders without photos.

## Out of scope
- Portraits on phone screens, in search results, and on the drag ghost (phone screens: T-101 and the later phone tasks; others: report a backlog candidate if needed).
- Removing a photo, cropping, bundle import (T-098).
- Server or sync changes.
