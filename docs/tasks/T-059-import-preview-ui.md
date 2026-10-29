# T-059: Import preview UI

**Milestone:** 6 — Import and photos
**Depends on:** T-058 (import replace on the server) and T-030 (app shell). Both done before this task starts.
- No shared files with T-062 (`docs/import/`, `scripts/import-guide.test.mjs`). Do not edit the server, the importer, or core.

**Spec refs:** SPEC.md §8 (preview, then an explicit replace of Current; ambiguous identities are confirmed; notes and tags stay only with a confirmed match; a returning member is confirmed before `removed_date` clears), §15 steps 5–6 (review coverage, duplicates, identities, and discarded fields; no silent name-only merge; proposals keep their baselines). Artboard 8, `docs/design/ui-canvas/Import.dc.html`. The bracketed numbers on that artboard are placeholders.

## Goal
An admin can review a T-058 import preview, resolve every identity the server still requires, and only then replace Current. The screen shows the three report sources, the counts the preview JSON actually carries, the discarded allow-list fields, and a replace button that stays off until those identities are resolved. Nothing is mounted in the app shell. The screen is the preview at `/__preview/import`.

## Design decisions (binding)

The preview HTTP response from T-058 is the only data. Do not add server fields. It is:

```ts
{
  decisions: PersonDecision[];
  absent: { memberId: string; name: string }[];
  duplicates: ('organizations' | 'without-callings' | 'out-of-unit')[];
  inconsistentReports: boolean;
  returning: { key: string; memberId: string }[];
  needsCategory: string[];
  unfamiliar: { organization: string; group: string; title: string; vacant: boolean }[];
  keptPositions: number;
  matchedPositions: number;
}
```

`PersonDecision` is the importer type: `name`, `key`, `category` (`'adult' | 'youth' | null`), `sources`, `externalCallings` (`{ section, calling, servingUnit }[]`), and either `kind: 'matched'` with `memberId`, `kind: 'new'`, or `kind: 'ambiguous'` with `reason` `'namesake' | 'resembles' | 'report_conflict'` and `candidates` (`{ memberId, name }[]`).

`expectedVersion` is not in that JSON. The screen receives it as a prop. Replace sends it back with the resolutions.

### Review plan (`apps/web/src/features/import/plan.ts`)

```ts
export type ImportPreview = /* the JSON above */;

export type ImportResolution =
  | { action: 'match'; memberId: string; confirmReturn?: true }
  | { action: 'new'; category?: 'adult' | 'youth' };

export function planImportReview(preview: ImportPreview): ImportReview;
export function resolutionsFor(
  preview: ImportPreview,
  choices: Readonly<Record<string, ImportResolution>>,
): { ready: boolean; unresolved: number; resolutions: Record<string, ImportResolution> };
```

`planImportReview` does not mutate its argument.

Sources, in this order:

| Name | Status |
|---|---|
| Callings by Organization | `Duplicate report` when `duplicates` contains `organizations`; otherwise `Validated` |
| Members without Callings | same for `without-callings` |
| Out-of-Unit Callings | same for `out-of-unit` |
| Directory photos | always `Not collected yet`. Detail `Optional · upload in the app or collect later` |

Stats, in this order, decimal numbers with no brackets:

| Label | Value |
|---|---|
| People | `decisions.length` |
| Matched positions | `matchedPositions` |
| Kept positions | `keptPositions` |
| Outside-ward callings | sum of `externalCallings.length` |
| Unfamiliar callings | `unfamiliar.length` |

`blocked` is `'duplicate_report'` when `duplicates.length > 0`, else `'inconsistent_reports'` when `inconsistentReports` is true, else `null`. Duplicates win when both are set, matching the server's check order.

Rows that need a decision, in decision order, then returning rows whose key was not already a row:

- `ambiguous` / `namesake`: detail `Namesakes need a choice. Notes and tags stay with the person you match.` Match options are the candidates in order. `needsCategory` is true when `category` is null.
- `ambiguous` / `resembles`: detail `Similar to an existing member. Notes and tags stay only if you match them.` Candidates in order. `needsCategory` when `category` is null.
- `ambiguous` / `report_conflict`: detail `The reports disagree about this person. They cannot be matched to an existing member.` No match options. `needsCategory` is true.
- `returning` for a `matched` decision: detail `This member was removed. Confirm it is the same person returning, or treat them as new.` One match option, that `memberId`, label `Same person returning`. `needsCategory` when the decision `category` is null.
- `new` whose key is in `needsCategory`: detail `Choose adult or youth. Age is not stored.` No match options. `needsCategory` is true.

A `matched` decision that is not returning, and a `new` decision whose key is not in `needsCategory`, produce no row. Absent members are not rows.

`resolutionsFor` treats a row as resolved only when:

- namesake or resembles: `{ action: 'match', memberId }` for one of its candidates, or `{ action: 'new', category: 'adult' | 'youth' }` when `needsCategory`, or `{ action: 'new' }` when not.
- report_conflict: `{ action: 'new', category: 'adult' | 'youth' }`. A `match` is not resolved.
- returning: `{ action: 'match', memberId, confirmReturn: true }` for that same id, or `new` with the category rule above. A match without `confirmReturn` is not resolved.
- category-only new: `{ action: 'new', category: 'adult' | 'youth' }`.

`unresolved` is the number of rows that fail that rule. `ready` is true only when `unresolved` is 0 and `blocked` is null. `resolutions` contains one entry per resolved row and nothing else. An unknown choice key is ignored. Do not default a missing category to adult.

### HTTP (`apps/web/src/features/import/client.ts`)

```ts
export function postImportPreview(
  fetchImpl: typeof fetch,
  body: { organizations: string; withoutCallings: string; outOfUnit: string },
): Promise<
  | { ok: true; preview: ImportPreview }
  | { ok: false; code: 'forbidden' | 'bad_request' | 'too_large' | 'offline' }
>;

export function postImportReplace(
  fetchImpl: typeof fetch,
  body: {
    organizations: string;
    withoutCallings: string;
    outOfUnit: string;
    expectedVersion: number;
    resolutions: Record<string, ImportResolution>;
  },
): Promise<
  | { ok: true; matched: number; created: number; removed: number }
  | { ok: false; code: 'forbidden' | 'bad_request' | 'too_large' | 'offline' | 'duplicate_report' | 'inconsistent_reports' | 'unresolved' | 'stale'; currentVersion?: number }
>;
```

Both POST JSON to `/api/import/preview` and `/api/import/replace` with `credentials: 'same-origin'` and `Content-Type: application/json`. PDF fields are standard base64 with no data-URL prefix. 401 and 403 are `forbidden`. 413 is `too_large`. 400 is `bad_request`. A thrown fetch is `offline`. Replace 409 uses the server's `error` string. `stale` keeps `currentVersion` when it is a number. Any other status is `bad_request`. Do not log the body.

`readReportFiles(files: { organizations: File; withoutCallings: File; outOfUnit: File }): Promise<{ organizations: string; withoutCallings: string; outOfUnit: string }>` reads each file as base64 with no data-URL prefix.

### Screen (`apps/web/src/features/import/ImportReview.tsx`)

Props: `preview`, `expectedVersion`, `onReplace: (input: { expectedVersion: number; resolutions: Record<string, ImportResolution> }) => Promise<{ ok: true; matched: number; created: number; removed: number } | { ok: false; code: string; currentVersion?: number }>`.

- Page heading `Review before replacing Current`. Eyebrow text `IMPORT · REPLACE CURRENT`.
- An ordered list `aria-label="Import steps"` with `1 · Sources`, `2 · Preview` (`aria-current="step"`), `3 · Photos`, `4 · Confirm`. The last two are text, not links.
- One card per source: name, detail, status. Status is text, not color alone.
- One card per stat: the number, then the label.
- Section heading `Needs your decision · N identities` where N is the row count (`1 identity` when N is 1, `0 identities` when N is 0). When N is 0, also show `No identities need a decision.`
- Each row shows the decision name and detail. Match buttons use the option label and `aria-pressed`. `Treat as new person` is `aria-pressed` when new is chosen. When the row `needsCategory` and the current choice is new or there are no match options, show `Adult` and `Youth` with `aria-pressed`. Use the existing `Button` from `apps/web/src/design/`. Each button is at least 44px tall.
- Discarded heading `Discarded before saving`, the sentence `Fields outside the allow-list never reach storage, logs or backups.`, and these labels with line-through: Phone, Email, Address, Birth date, Age, Record number, Class rosters, Ministering. Kept text: `Names · youth/adult · callings and positions · vacancies · outside-ward callings`.
- When `blocked` is `duplicate_report`, a `role="alert"` says `This file was already imported. Replace stays off.` When `inconsistent_reports`, `These reports disagree. Replace stays off.`
- The replace control is disabled unless `resolutionsFor` is ready. Disabled with unresolved rows: accessible name `Resolve N identities to continue` (`identity` when N is 1). Ready: accessible name `Replace Current`, and it calls `onReplace` with `expectedVersion` and `resolutions`. The note beside it: `Proposals keep their own baselines. Notes and tags carry over only for confirmed matches.`
- Success text, exactly `Replaced Current. Matched ${matched}, created ${created}, removed ${removed}.` A failure uses `role="alert"` and does not show that success line. `stale` says `Current changed. It is now version ${currentVersion}.` Other codes say `Replace did not run (${code}).`

Layout uses `apps/web/src/features/import/import.css` and the existing tokens (`--wb-ground`, `--wb-surface`, `--wb-ink`, `--wb-muted`, `--wb-line`, `--wb-accent`, `--wb-vacancy-fill`, `--wb-vacancy-border`). Do not invent a second palette. At 390px the page does not scroll horizontally. Cards wrap instead of forcing a wide row.

### Preview (`apps/web/src/features/import/preview.tsx`)

Discovered by the existing glob. Do not edit `apps/web/src/preview/**`.

`/__preview/import` renders `ImportReview` with `expectedVersion` 3 and this fictional preview (no server, no real names):

- Ambiguous namesake `Lark, June` (`lark, june`), category null, candidates `June Lark` (`m-june`) and `June L. Lark` (`m-junel`).
- Ambiguous resembles `Pineda, Otto` (`pineda, otto`), category `adult`, one candidate `Otto Pineda` (`m-otto`).
- `duplicates: []`, `inconsistentReports: false`, `returning: []`, `needsCategory: ['lark, june']`, `unfamiliar: []`, `keptPositions: 4`, `matchedPositions: 12`, `absent: []`, `externalCallings: []` on both decisions, `sources: ['organizations']`.

The preview's `onReplace` records the success line `Replaced Current. Matched 1, created 1, removed 0.` and does not call the network. It must not run because of a render.

## Scope
May change:
- `apps/web/src/features/import/**` (new)
- `apps/web/e2e/import.spec.ts` (new)
- `apps/web/e2e/gui/import.capture.ts` (new)

Must not change:
- `apps/server/**`, `packages/**`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `App.tsx`, `apps/web/package.json`, `scripts/**`, `docs/**`, `playwright.config.ts`, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/features/import` | every test below passes |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/import.spec.ts` | passes on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/import/` has `review-<project>.png` and `ready-<project>.png` for desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only the May-change paths |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run 2, 3, and 5 one at a time in this worktree. The shell starts in the shared checkout; `cd` to the task worktree first. GUI verification is required at desktop, phone (Chromium and WebKit), and TV. Look at the screenshots and compare them with artboard 8.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `stats come from the preview counts` | people, matched, kept, outside-ward, and unfamiliar match the JSON | a hardcoded artboard number |
| `a namesake stays unresolved until a candidate or a new category is chosen` | neither an empty choice nor `new` without a category is ready; matching one candidate is ready and sends only that resolution | defaulting the category to adult |
| `a conflict cannot be matched` | a `match` leaves the row unresolved; `new` with `youth` resolves it | accepting a match for `report_conflict` |
| `a returning member stays unresolved until return is confirmed` | match without `confirmReturn` is not ready; `confirmReturn: true` for that id is ready | clearing the return with an ordinary match |
| `a duplicate report keeps replace off` | identities can be resolved and `ready` stays false with `duplicate_report` | enabling replace anyway |
| `disagreeing reports keep replace off` | `inconsistentReports` with no duplicates sets `inconsistent_reports` | ignoring the flag |
| `preview posts the three pdf fields` | the stub fetch sees POST `/api/import/preview`, JSON keys `organizations`, `withoutCallings`, `outOfUnit`, and no data-URL prefix | a multipart body or a data-URL |
| `replace sends the version and the resolutions` | POST `/api/import/replace` includes `expectedVersion` and the resolutions | dropping the version |
| `a forbidden preview is not a preview` | 403 returns `forbidden` and no decisions | treating 403 as an empty success |
| `a stale replace names the current version` | 409 `{"error":"stale","currentVersion":4}` returns `stale` and `currentVersion` 4 | hiding the version |
| `the review hides the replace action until every identity is resolved` | the button name is `Resolve 2 identities to continue` and it is disabled; after June Lark is matched and Otto is treated as new, the name is `Replace Current` and it is enabled | a button that is enabled while a namesake is open |
| `choosing adult or youth is visible on the namesake row` | the namesake row shows `Adult` and `Youth` after Treat as new; the resembles row, whose category is adult, does not | skipping the category control |
| `discarded fields stay visible as text` | Phone, Email, Address, Birth date, Age, Record number, Class rosters, and Ministering are present | dropping the allow-list disclosure |
| `a failed replace does not announce success` | a rejected `onReplace` shows the alert and not `Replaced Current` | showing the success line anyway |
| `files become base64 without a data url` | `readReportFiles` returns the file bytes as base64 and the string does not start with `data:` | prefixing a data URL |

## Edge cases (each needs a test)
Covered above: empty decision list is not required as its own row test; the zero-identity heading is covered by rendering a preview with no rows in `the review hides the replace action` only if you also render that state. Add `no identities leaves replace enabled` for a preview with one matched decision, no returning, no duplicates: heading `Needs your decision · 0 identities`, button `Replace Current` enabled, and `onReplace` receives `resolutions` `{}`.

Also cover an offline fetch (the stub throws) as part of `a forbidden preview is not a preview` or a sibling `an offline preview is offline`. A 413 body is `too_large`.

## Human checks
iPhone, after the preview is deployed: open `/__preview/import`, match one name and treat the other as new, and confirm the steps, the decision rows, and Replace Current can be used one-handed without sideways scrolling.

## Out of scope
- Mounting the screen in the app shell or Settings.
- Directory photo collection (T-061) and the import guide (T-062).
- Changing the preview JSON or the replace route.
- Handbook title aliases (B-054) and custom-row origin (B-055).
