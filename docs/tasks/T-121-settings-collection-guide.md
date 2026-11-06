# T-121: Import guide for Settings collection

**Milestone:** 8 — Directory photos from Settings
**Depends on:** T-120 (Settings collect and review). Done.
**Spec refs:** SPEC.md §15 (the human signs in on the computer running WardBoard; the app never asks for a password; the command-line collector remains; staging outside Git is cleaned up), §16 milestone 8. PLAN.md Milestone 8 row T-121.

## Goal
The import guide's primary directory-photo steps are the Settings action. The command-line collector stays as the fallback, with the same commands. A structural check fails if either the Settings steps or the fallback command are removed.

## Scope
May change:
- `docs/import/guide.md`
- `scripts/import-guide.test.mjs`

Must not change:
- `docs/import/operator-prompt.md`
- application source, tests other than the structural check, `docker/**`, and `docs/tasks/**` other than this contract

New dependencies allowed: none

## Design decisions (binding)

This is a documentation task. The executable check is `scripts/import-guide.test.mjs`. Do not weaken an existing assertion. The version line is the line immediately after the h1, and the test constant must match it exactly:

`Version: four-PDF replace and Settings directory photo collection.`

In **Directory photos**, the primary steps come before the command-line fallback, in this order, as ordinary sentences (not a fenced command):

1. An Admin opens Settings and uses **Collect from the directory**.
2. The sign-in window opens on the computer running WardBoard. A phone does not show that window.
3. The Admin signs in there, then presses **Continue** in Settings.
4. Review opens without choosing files. First photos apply immediately. An existing portrait is replaced one photo at a time.
5. Cancel, a failed run, and a finished import remove the temporary collection files. Do not tell the Admin to run `--cleanup` for this Settings path.
6. An Editor does not see **Collect from the directory**. Both roles can still open **Import an existing bundle**, select `manifest.json` and the portrait files, and review.

Then the existing command-line fallback, introduced as the fallback when Settings cannot open the window (the server has no collector, or the data directory is inside a Git checkout). Keep these as their own lines:

```
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --resume
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --cleanup
```

Keep the existing rules in that section: staging outside any Git repository, `manifest.json`, names never appear in the output, exit codes `0`, `1`, and `2`, and `--headless` is for tests only. The fallback handoff still says to run `--cleanup` after importing a bundle that was collected from the command line.

Do not add `TODO`, `TBD`, `<command>`, `npx wardboard-collector`, or `churchofjesuschrist.org` inside a fenced block. Keep the credentials sentence in **Sign in**.

Add one test, `the guide's primary photo steps are Settings`:

- The **Directory photos** section contains `Collect from the directory`, `Continue`, `A phone does not show that window`, and `Import an existing bundle`.
- `Collect from the directory` appears before the fallback command `pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging`.
- The three fallback commands are still their own lines.
- The Settings portion does not tell the reader to run `--cleanup` before the fallback heading. Use a line `Command-line fallback` to split the section. `--cleanup` appears only after that line.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Guide structure | `node --test scripts/import-guide.test.mjs` | exit 0, including `the guide's primary photo steps are Settings` |
| 2 | Mutation | in a disposable copy, delete the line or sentence that contains `Collect from the directory`, then run the same command | `the guide's primary photo steps are Settings` fails; restore the copy; the candidate is unchanged |
| 3 | Quality gate | `./scripts/verify.sh` | exit 0 |

## Unit tests to write

The structural test above is the required check. It fails if the Settings steps are removed or moved below the fallback command, or if a fallback command line is removed.

## Edge cases (each needs a test)
- The version line matches the new sentence exactly.
- `--cleanup` remains a fallback command line and is not part of the Settings steps.
- Existing credential, download, preview, replace, gender, and operator-prompt checks still pass.

## Human checks
none

## Out of scope
- Changing the collector, the Settings screen, or the operator prompt.
- Claiming the Docker image can open the sign-in window.
