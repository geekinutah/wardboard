# T-062: Import guide and AI-operator prompt

**Milestone:** 6 — Import and photos
**Depends on:** T-058 (import replace on the server), done before this task starts.
- No shared files with T-059 (`apps/web/src/features/import/`, `apps/web/e2e/import.spec.ts`, `apps/web/e2e/gui/import.capture.ts`).

**Spec refs:** SPEC.md §15 "Human instructions to ship with Import" and "Reusable prompt for an optional AI operator". The directory collector's packaging, launch command, and recovery are not verified (SPEC §15 "Verification required before shipping collectors", and T-061). This guide must not invent them.

## Goal
Ship a versioned human guide and a copyable operator prompt for the import that exists today: an admin downloads the three official PDFs and replaces Current through `POST /api/import/preview` and `POST /api/import/replace`. A person can follow the guide with no model service. The prompt tells an optional agent to use that guide and to stop rather than scrape.

## Design decisions (binding)

### `docs/import/guide.md`
The first heading is `WardBoard import guide`. The next line is exactly `Version: manual PDF replace. Directory collector: not shipped.`

The guide includes these sections, in order:

1. **What this version does.** An admin previews three PDFs and then replaces Current. Proposals keep their own baselines. Notes and tags carry over only for a confirmed match. The app does not archive the PDFs. Directory photo collection is not shipped; portraits are uploaded in the app, one replacement at a time. Do not invent a collector, a scraper, or a command that downloads Church files.

2. **Sign in.** The person signs in to the Church site in their own browser, including MFA. WardBoard, the guide, and any chat never ask for a password or an MFA code. The sentence `Do not paste credentials into WardBoard, a collector, or a chat.` appears in this section.

3. **Download the three reports.** The official clicks, as prose the operator can follow:
   - Callings → Callings by Organization → Print → Download PDF
   - Reports → Members without Callings → Print → Download PDF
   - Reports → Out-of-Unit Callings → Print → Download PDF
   For the organization report, prefer Callings only, with Members and Ministering excluded where the UI allows. Wait until generation finishes. Keep the PDFs in a private folder the person chooses. Do not commit them.

4. **Preview.** A real command, not a placeholder, that POSTs JSON to `/api/import/preview`. The body keys are `organizations`, `withoutCallings`, and `outOfUnit`. Each value is standard base64 of that PDF with no `data:` prefix. The command uses a cookie jar and an `Origin` header equal to the app origin. Say that an editor receives `403` `{"error":"forbidden"}` and a missing session receives `401` `{"error":"unauthenticated"}`. Say that a body over 2_000_000 bytes receives `413` `{"error":"too_large"}`.

5. **Read the preview.** Name the counts the JSON returns: `decisions`, `absent`, `duplicates`, `inconsistentReports`, `returning`, `needsCategory`, `unfamiliar`, `keptPositions`, `matchedPositions`. Say that `duplicates` other than `[]` means do not replace (`409` `{"error":"duplicate_report"}` on a second attempt). Say that `inconsistentReports: true` means the three reports disagree and replace is refused. Say that namesakes, resembling names, report conflicts, returning members, and a missing adult/youth category are resolved by the operator, not guessed. Discarded and never stored: phone, email, address, birth date, age, record number, class rosters, ministering. Age is not a field in the preview.

6. **Replace.** A real command that POSTs the same three PDF fields plus `expectedVersion` (the current board version) and `resolutions`. Document the two resolution shapes: `{ "action": "match", "memberId": "...", "confirmReturn": true }` and `{ "action": "new", "category": "adult" }` or `"youth"`. Say a returning member stays removed until `confirmReturn` is true. Success is `200` with `replaced`, `importVersion`, `importedAt`, `matched`, `created`, and `removed`. A stale board is `409` `{"error":"stale","currentVersion":N}` and writes nothing.

7. **Afterward.** The person checks the success counts, keeps or deletes their own PDF copies, and signs out of the Church site when they choose. The app does not delete those copies. Do not paste member names, photos, or raw PDF text into chat.

Use the fictional paths `fixtures/lcr-reports/organizations-and-callings.pdf`, `fixtures/lcr-reports/members-without-callings.pdf`, and `fixtures/lcr-reports/out-of-unit-callings.pdf` only as the example inputs for a local dev server. Say they are fictional. Do not embed PDF bytes, names from those files, or a real ward.

No `TODO`, `TBD`, `<command>`, or `npx wardboard-collector`. No command that opens a Church URL, drives a browser, or scrapes a directory.

### `docs/import/operator-prompt.md`
A fenced block the operator can copy. Its text contains every sentence below, in this order, and no extra instructions that tell the agent to scrape, to ask for a password, or to invent a collector:

- `Use the installed, documented deterministic collector and parsers; do not build an ad hoc scraper, use a model to interpret records, or send source data to an AI/API service.`
- `If the collector is missing, stop and explain what must be installed instead of improvising a data collection method.`
- `Never ask me to send credentials in chat.`
- `Do not read, copy, store, export or log passwords, cookies, tokens, browser profiles or session state.`
- `Limit acquisition to the selected ward's Callings by Organization, Members without Callings and Out-of-Unit Callings PDFs, plus individual directory portraits if I request photos.`
- `Do not paste member lists, photos, raw PDF text, full-page captures or personal values into chat, agent memory, logs, repositories or external services.`
- `Present the import preview and let me resolve identity ambiguities and confirm replacement of current.`
- `Never claim a completed import, photo collection, or cleanup without checking the tool's reported result.`

Above the fence, one paragraph: the directory collector is not shipped, so the human route in `docs/import/guide.md` is the manual PDF download and the two HTTP commands. The agent follows that guide.

### `scripts/import-guide.test.mjs`
`node:test` and `node:assert/strict`, no dependencies. Read the repo root relative to the test file, the same way `scripts/docker.test.mjs` does. `node --test scripts/` already runs it. Do not edit `scripts/verify.sh`.

## Scope
May change:
- `docs/import/guide.md` (new)
- `docs/import/operator-prompt.md` (new)
- `scripts/import-guide.test.mjs` (new)

Must not change:
- `apps/**`, `packages/**`, `scripts/verify.sh`, existing `scripts/*.test.mjs`, `docs/tasks/**`, `SPEC.md`, anything else

New dependencies allowed: none.

Application unit tests do not apply. This task changes documentation only. The executable checks are the structural tests below, and the mutation proves they catch a realistic defect.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests | `node --test scripts/import-guide.test.mjs` | `# fail 0`; every test below passes |
| 2 | Red before green | run check 1 before the two docs exist | the tests fail because `docs/import/guide.md` or `docs/import/operator-prompt.md` is missing; record that output |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0, and under `node --test scripts/` the suite `import guide` passes its 10 tests. Node's spec reporter prints that suite name, not the filename |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only the three May-change paths |
| 5 | Mutation | in a disposable worktree at the candidate, delete the sentence `Do not paste credentials into WardBoard, a collector, or a chat.` from the guide and run check 1 | `the guide forbids pasting credentials` fails; restore the file; then add the line `npx wardboard-collector` to the guide and run check 1 again | `the guide does not invent a collector command` fails; remove the worktree afterward |

The shell starts in the shared checkout. `cd` to the task worktree first. Run at most one `./scripts/verify.sh` in that worktree.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the guide names this version and the missing collector` | the first heading is `WardBoard import guide` and the next line is `Version: manual PDF replace. Directory collector: not shipped.` | a guide that claims the collector is installed |
| `the guide forbids pasting credentials` | the sign-in section contains `Do not paste credentials into WardBoard, a collector, or a chat.` | the sentence removed |
| `the guide names the three official downloads` | all three click paths are present, including `Callings by Organization`, `Members without Callings`, and `Out-of-Unit Callings` | a path dropped |
| `the guide previews with the three json fields` | a fenced command contains `POST` or `-X POST`, the path `/api/import/preview`, and the keys `organizations`, `withoutCallings`, and `outOfUnit` | a placeholder command, or a data-URL body |
| `the guide replaces with a version and resolutions` | a fenced command contains `/api/import/replace`, `expectedVersion`, and `confirmReturn` | replace documented without the version |
| `the guide refuses a duplicate and a disagreement` | the text contains `duplicate_report` and `inconsistentReports` | telling the operator to replace anyway |
| `the guide lists the discarded fields` | phone, email, address, birth date, age, record number, class rosters, and ministering each appear as discarded | one field omitted |
| `the guide does not invent a collector command` | the guide contains none of `wardboard-collector`, `TODO`, `TBD`, or `<command>` | an invented collector command |
| `the operator prompt keeps the required sentences` | `operator-prompt.md` contains each required sentence in the decision list, in that order | a sentence dropped or reordered |
| `the operator prompt points at the manual guide` | the paragraph above the fence contains `docs/import/guide.md` and `not shipped` | a prompt that assumes the collector exists |

## Edge cases (each needs a test)
Covered above: missing collector, duplicate report, disagreeing headers, discarded fields, no placeholder command.

## Human checks
none

## Out of scope
- Implementing the import screen (T-059) or the directory collector (T-061).
- Changing the HTTP API, the Dockerfile, or `verify.sh`.
- Embedding fixture names from the PDFs, or any real member data.
