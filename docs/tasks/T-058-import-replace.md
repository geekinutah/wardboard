# T-058: Import replace on the server

**Milestone:** 6 — Import and photos
**Depends on:** T-057 (done), T-023 (done).
- No shared files with any in-flight task.

**Spec refs:** SPEC.md §8 (preview, then atomic replacement of Current; exact unique name reuses the member; ambiguous identities are confirmed; notes and tags kept only for a confirmed match; a missing member gets `removed_date` and their Current callings become vacancies; a returning member clears `removed_date` only after confirmation; proposals and baselines are not rewritten), §15 (allow-listed fields only; no phone, email, birth date, address, or Church identifier stored or logged; category is adult or youth only when the without-callings report decided it).

## Goal
An admin can preview three report PDFs and then replace Current in one transaction. The position catalog, including vacant and custom positions, stays. Occupants move to the report. Proposals stay as they were.

## Design decisions (binding)

### Dependency
Add `@wardboard/importer` `workspace:*` to `apps/server/package.json`. `pnpm-lock.yaml` may change only for that workspace link. No other new dependency.

### Authorization and routes
Both routes require a signed-in admin, method POST, and an `Origin` that equals the app origin or the listen origin (same rule as backup restore).

| Case | Status | Body |
|---|---|---|
| No session, unknown login, or revoked user | 401 `unauthenticated` or 403 `forbidden`, matching the existing gate in `server.ts` | |
| Signed-in editor | 403 | `{"error":"forbidden"}` |
| Admin, wrong method | 405 | `{"error":"method_not_allowed"}` and `allow: POST` |
| Admin, missing or foreign Origin | 403 | `{"error":"forbidden"}` |
| Admin, body larger than 2_000_000 bytes | 413 | `{"error":"too_large"}` |
| Admin, preview or replace of a bad PDF or bad JSON | 400 | `{"error":"bad_request"}` |

Routes: `POST /api/import/preview` and `POST /api/import/replace`. JSON body. PDF fields are standard base64 (no data-URL prefix). Do not write the PDF bytes, raw text, or a copy of the body under the data directory.

### Planning functions
Export `planImport` and `applyImport` from `apps/server/src/import/index.ts`. Behavior tests call these functions with the smallest valid `ImportBundle` values. They do not build PDFs. The HTTP routes are the only PDF entry: `importReports`, then `planImport`.

`planImport({ bundle, ward, current, previousFingerprints })` calls `reconcile` and does not read the database. The HTTP preview loads Current and, when `importVersion` matches `/^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/`, passes those three hex strings as `previousFingerprints` for organizations, without-callings, and out-of-unit. Any other stored version, including `fixture`, passes no previous fingerprints. The returned plan includes the reconcile fields, the position plan, the organizations `reportDate`, and the three fingerprints.

`applyImport({ plan, resolutions, expectedVersion, ids, clock })` is pure. It returns the next ward and current board, or `{ ok: false, error }` without a ward. The route maps `duplicate_report`, `inconsistent_reports`, `unresolved`, and `stale` to HTTP 409 with the bodies below. `applyImport` does not touch SQLite. `store.replaceCurrent` writes the successful result in one transaction after `createWard` and `createBoard` succeed. New member, position, lineage, assignment, and group ids come from `ids` in document order: each new board group, then its new calling group, then its new assignment, then its new position.

Preview writes nothing. Response 200:

```ts
{
  decisions: PersonDecision[];
  absent: { memberId: string; name: string }[];
  duplicates: ReportKind[];
  inconsistentReports: boolean;
  returning: { key: string; memberId: string }[];
  needsCategory: string[];
  unfamiliar: { organization: string; group: string; title: string; vacant: boolean }[];
  keptPositions: number;
  matchedPositions: number;
}
```

`returning` lists matched decisions whose member has a non-null `removedDate`. `needsCategory` lists keys of `new` decisions whose `category` is null, plus keys of `ambiguous` decisions. `keptPositions` is the number of current positions that the report does not use. `matchedPositions` is the number of report rows placed on an existing position.

### Position plan
Match key: `canonicalName(organization) + "\u0000" + canonicalName(group) + "\u0000" + canonicalName(title)`.

Walk report positions in document order. The nth row of a key uses the nth existing position of that key. The key uses the report organization name, so a board group reached only through the key map is not consumed here. Existing order is `position.order` ascending, and position id ascending when orders tie. A row with no such position is not yet unfamiliar.

When that row then selects a board group by the key map or by canonical board-group name, and that group already has the calling group and the same-title assignment, fill the next unused position of that assignment before creating one. A single assignment's position is filled this way. Create the extra list only after that position is already used. Count the filled position as matched, not unfamiliar or kept. Only a row that still has no position after that is unfamiliar.

Board group for a new row, first match wins:
1. The existing group whose `key` is in this map from `canonicalName(organization)`: `bishopric`, `elders quorum` → `elders_quorum`, `relief society` → `relief_society`, `aaronic priesthood quorums` → `aaronic_priesthood`, `young women` → `young_women`, `sunday school` → `sunday_school`, `primary` → `primary`, and `ward missionaries`, `temple and family history`, `young single adult`, `other callings` → `ward_wide`.
2. An existing group whose canonical name equals the organization name.
3. Otherwise create one group: printed organization name, that key when it is not already used, otherwise `key: null`, `visible: true`, order after the current max.

Calling group: under that board group, reuse a group with the same canonical name. Otherwise create one, kind `other`, `key: null`, parent that board group, order after the current max.

Assignment: within that calling group, the assignment with the same canonical title, if any.
- No assignment and one row: create a `single` assignment and one position.
- No assignment and several rows: create one `list` assignment and one position per row.
- Assignment exists: fill its positions in order. Extra list positions are appended. A `single` assignment is never given a second position and its type does not change; extra rows become a new `list` assignment with the same printed title.
- Fewer report rows than positions: the extra positions stay and are vacant.

New assignments: `enabled: true`, `prominent: false`, `origin: 'standard'`, `leadershipRole: null`, empty tag arrays, order after the current max in the group. New positions get a new id and a new lineage id. Existing position ids, lineage ids, assignment ids, group ids, oversight, and dugout inclusions stay. No position, assignment, or group is deleted.

### People
Resolutions are required on replace, keyed by decision key:

```ts
{ action: 'match'; memberId: string; confirmReturn?: true }
| { action: 'new'; category?: 'adult' | 'youth' }
```

- `matched`, `removedDate === null`: no resolution. Reuse that id.
- `matched`, `removedDate !== null`: require `{ action: 'match', memberId, confirmReturn: true }` for that same id, or `{ action: 'new', category }` when the decision category is null and `{ action: 'new' }` when it is not.
- `ambiguous` `namesake` or `resembles`: require `match` of one listed candidate, or `new`.
- `report_conflict`: require `new`. `match` is rejected.
- `new` with a category: no resolution, or a redundant `new` that does not contradict it.
- `new` with null category, or `new` chosen above with null category: the resolution includes `category`.

A contradicting or unknown `memberId` is unresolved.

Chosen existing member: keep `note`, `tagIds`, `photoRef`, and `needsApproval`. Set `name` to the decision name. Set `category` from the decision when it is non-null; otherwise keep the stored category. Replace `externalCallings`. Clear `removedDate`.

New member: new id, decision name, category from the decision or the resolution, `photoRef: null`, `note: null`, `tagIds: []`, `needsApproval: false`, `removedDate: null`.

External callings, report order: `title` is `calling`. `unit` is `servingUnit` when it is a non-empty string, otherwise `Stake` for section `stake` and `Living outside of Unit` for `living-outside-unit`.

Existing members who are not chosen:
- In `absent`, or an unchosen candidate of a namesake or resembles decision: set `removedDate` to the organizations `reportDate` when their current `removedDate` is null. When it is already set, keep the earlier ISO date. Do not copy their note, tags, or photo onto a new member.
- Exact-key member of a `report_conflict`, or a member who only resembles a conflict key: do not change `removedDate`, note, tags, photo, category, or external callings.

### Placements
For a report row that is not a `report_conflict` and has an occupant, place the chosen member on the planned position. A vacant report row, a conflict row, and a kept position with no report row are vacant. A member is placed at most once in one list assignment, because `createBoard` rejects `list_duplicate_member`. When a later row of that same list would place a member already placed in it, that later position stays vacant. Do not make a second assignment to hold the repeat, and do not change `packages/core`. The same member may still hold a different assignment. The fictional Ward Missionaries report has two `Ward Missionary` rows for `Wrenford, Una`; the second stays vacant so the fixture replace can commit. Remove approvals whose member is not the placement. Leave oversight and dugout inclusions unchanged. Current keeps its id and kind. `version` becomes `expectedVersion + 1`.

`importVersion` is the three `reportFingerprint` hex strings joined by `.`, organizations, without-callings, out-of-unit. `importedAt` is `clock().toISOString()`. The clock and id generator are the server's injected ones. Do not read `Date.now` or `Math.random`.

### Replace
Body is the preview body plus `expectedVersion` and `resolutions`. Refuse, writing nothing, with 409:

| Condition | Body |
|---|---|
| `duplicates.length > 0` | `{"error":"duplicate_report"}` |
| `inconsistentReports` | `{"error":"inconsistent_reports"}` |
| any decision still unresolved | `{"error":"unresolved"}` |
| `expectedVersion` is not the current board version | `{"error":"stale","currentVersion":N}` |

Success 200: `{"replaced":true,"importVersion":"...","importedAt":"...","matched":N,"created":N,"removed":N}`. `matched` counts chosen existing ids. `created` counts new ids. `removed` counts members whose `removedDate` changed from null to a date.

One SQLite transaction updates members, external callings, the current board, and that board's import version and imported-at. It does not update any proposal, baseline, acceptance, or summary. On throw or validation failure, roll back. A stale version is checked before any write.

After commit, call `publishImport()` on the operation channel. That broadcasts the existing `ward` message, the existing `boards` message, and, to sockets subscribed to the current board, the existing `committed` message with the new board. Do not add a new WebSocket message type.

### Logs
When a log callback is used, preview and replace each emit one line, `import preview matched=N new=N ambiguous=N absent=N duplicates=N` or `import replace matched=N created=N removed=N`. No names, phones, emails, dates of birth, addresses, or record numbers. Do not call `console.*`. A refusal or throw does not log that success line.

## Scope
May change:
- `apps/server/package.json`
- `pnpm-lock.yaml` (the new workspace link only)
- `apps/server/src/import/**` (new)
- `apps/server/src/server.ts` (route dispatch, and an optional `log` callback passed into the import handler)
- `apps/server/src/store/types.ts`, `apps/server/src/store/index.ts`, `apps/server/src/store/persist.ts` (one transactional replace)
- `apps/server/src/ws/channel.ts` (`publishImport` only)
- `apps/server/test/import/**` (new)
- `docker/Dockerfile` (copy `packages/importer/src` into the runtime image, and the comment that names it)

Must not change:
- `packages/importer/**`, `packages/core/**`, `apps/web/**`, parsers, fixtures, `docs/tasks/**`, existing tests, anything else.

New dependencies allowed: `@wardboard/importer` workspace dependency only.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Import tests | `pnpm --filter @wardboard/server exec vitest run test/import` | every test below passes |
| 2 | Server tests | `pnpm --filter @wardboard/server test` | exits 0 |
| 3 | Scope | `git diff --name-only origin/main...HEAD` | only the May change paths, including `docker/Dockerfile` |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Identity and position tests call `planImport` and `applyImport`, then `store.replaceCurrent` on a real temporary SQLite database, the same way `apps/server/test/store/lifecycle.test.ts` opens one. Build the smallest `ImportBundle` and a current board whose group and calling names match the rows under test. Do not build PDFs for those tests.

Route tests use the real server, the same way `apps/server/test/backup/routes.test.ts` does. Use the fictional PDFs in `fixtures/lcr-reports/` for preview, leakage, duplicate refusal, and the WebSocket test. No real member data. A route test may build `resolutions` from the preview JSON.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `an exact unique match keeps the note and reuses the id` | one occupant equal to an existing member with a note, tags, photoRef, and needsApproval → same id, same note, tags, photo, and needsApproval; name updated; not absent | a new id; a null note |
| `an unchosen namesake is removed without taking the note` | two exact members, resolution `new` → both get `removedDate` equal to the organizations report date; the created member has a null note | copying the note; deleting the row |
| `a chosen namesake keeps the note` | resolution `match` of the second id → that note remains; the other id gets `removedDate`; placements use the chosen id | keeping both active; using the first id |
| `a returning member stays removed until confirmed` | matched member with `removedDate` → `applyImport` returns `unresolved` and the stored date is unchanged; the same call with `confirmReturn` clears it | clearing the date on preview; refusing the confirmed call |
| `declining a return creates a new member` | `action: new` for that returning match → old date remains, new id has a null note | reusing the id |
| `an earlier removed date is kept` | absent member whose `removedDate` is before the report date → the stored date does not move forward | overwriting with the report date |
| `a conflict vacates the seat and does not remove the member` | same name as occupant and without-callings youth, resolution `new` → position vacant, the created member has the new id, the exact existing member keeps `removedDate: null` and the old note | placing the existing member; setting `removedDate` |
| `a new calling holder needs a category` | occupant who is not an existing member and not a without-callings row → `applyImport` returns `unresolved` until `category: youth`; the stored category is youth and no age field exists | defaulting to adult |
| `a youth candidate stores youth and no age` | without-callings category youth, no calling → member category youth; JSON of the ward has no age or birth date | dropping the category |
| `a vacant report row keeps the position and clears the occupant` | existing lineage id remains, placement absent | deleting the position |
| `a custom position absent from the report is kept and vacated` | origin custom, title not in the report → position remains, placement absent | deleting the custom position |
| `an unfamiliar title adds one single position` | report title with no assignment → one new single position under the matching calling group; old lineage ids remain | dropping the row; changing an old lineage |
| `two new rows of one title add a list` | no existing assignment, two different occupants → one list assignment, two positions, same title, both occupied | two single assignments |
| `a repeated name fills only the first list row` | two rows of one new title with the same occupant → one list, two positions, only the first occupied | placing that member on both positions; creating a second assignment |
| `a single assignment is not widened` | one single assignment and two report rows → the single stays one position and a new list holds the extra row | setting the single assignment to two positions |
| `aaronic report rows use the aaronic board group` | current group key `aaronic_priesthood` named `Young Men / Aaronic Priesthood`, report org `Aaronic Priesthood Quorums` → the new calling group is parented to that key | creating a second board group |
| `a key-mapped organization fills the existing assignment` | board group key `ward_wide` named `Ward-wide Callings`, calling group `Music`, single `Music Coordinator`; one report row `Other Callings` / `Music` / `Music Coordinator` → that existing position is occupied, no second assignment is created, and the row is not unfamiliar | vacating the original position and adding a new list |
| `a key-mapped list fills before it appends` | that same board group, an existing list with one vacant position, and two report rows of that title → the existing position is filled and exactly one position is appended | appending two positions and leaving the original vacant |
| `proposals are untouched` | a proposal with its own placement and an accepted summary → `loadProposal` deep-equals after replace | rewriting the baseline or the summary |
| `a stale version writes nothing` | wrong `expectedVersion` → `stale` with `currentVersion`; ward, current, and proposals deep-equal the prior values | committing the new ward anyway |
| `duplicate and disagreeing reports are refused` | previous fingerprints equal to this bundle → `duplicate_report` and no write; different `reportDate` on one report → `inconsistent_reports` and no write. Posting the fictional PDFs twice through HTTP returns 409 `{"error":"duplicate_report"}` | replacing Current |
| `an editor and a revoked session are refused` | editor preview and replace → 403 `forbidden`; revoked admin → 403; no session → 401 `unauthenticated`; a foreign Origin → 403 | applying the replace |
| `the preview writes nothing and hides discarded fields` | preview of the three fictional PDFs → 200, `loadCurrent` unchanged, data directory file list unchanged, response and log do not contain `555-0100`, `canary.email@example.invalid`, `CANARY-MRN-998877665`, `CANARY-DOB-1974-01-31`, `CANARY-ADDR-1-SECRET-LANE`, or `CANARY-PHONE-555-0199`; a decision named `Stanley, Zed` is present | saving a PDF; echoing a phone |
| `replace announces the new ward and board` | an open WebSocket subscribed to Current receives `ward`, `boards` with the new import version, and `committed` for that board after a successful replace, and does not receive them after a 409 | skipping the broadcast |
| `the log is counts only` | the success line matches the counts and contains no fixture name; `console.*` is not called | logging a decision |

## Edge cases (each needs a test)
Covered above: unique match, namesakes, returning member, declined return, earlier removed date, report conflict, missing category, youth category, vacancy, custom position, unfamiliar title, list rows, a repeated list occupant, single assignment, board-group key, a key-mapped existing assignment, a key-mapped list that fills before it appends, proposals, stale version, duplicate report, inconsistent dates, editor, revoked session, anonymous, origin, preview leakage, websocket publish, log leakage.

## Human checks
none

## Out of scope
- The import preview screen (T-059).
- The import guide (T-062).
- Directory photo collection and photo replacement during import (T-060 already covers direct upload; T-061 is the collector).
- Deleting positions that the report does not mention.
- Guessing a leadership role for a new assignment.
- Changing a parser or the reconciler.
