# WardBoard directory photo collector

A local command that collects **individual member portraits** from the signed-in
Church directory (`directory.churchofjesuschrist.org`) into a private staging
folder on your computer. It is deterministic code: no AI model, model SDK or
model service is involved, and it runs the same way whether you start it
yourself or an AI operator starts it for you.

## Run it

From the WardBoard repository:

```sh
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging
```

1. A fresh Chromium window opens. It is a new, empty browser session: it never
   uses or changes your everyday browser or its profile.
2. Sign in to the directory **yourself** in that window, including MFA. The
   collector never asks for, types, reads or stores your password, cookies or
   session.
3. When the directory's household list is showing, press **Enter** in the
   terminal.
4. The collector walks the households and prints progress as counts only, for
   example `Households 3 of 12 · portraits 5 · missing 1 · failed 0 · household images skipped 2`.
   Names never appear in the output.

If your sign-in expires during a run, the collector pauses and asks you to sign
in again in the same window, then press Enter. It restarts the current
household from its beginning.

Press **Ctrl-C** to cancel. Progress is saved.

### Options

| Option | Meaning |
|---|---|
| `--staging <dir>` | Required. A private folder you choose, **outside any Git repository** (the collector refuses otherwise). The collector works only inside `<dir>/wardboard-collector/`, created with owner-only permissions. |
| `--resume` | Continue a cancelled or interrupted collection in the same `--staging` folder. Households already finished are not collected again, and the result is the same as an uninterrupted run. A collection more than 7 days old cannot be resumed; clean it up instead. |
| `--cleanup` | Delete what the collector created in `<dir>/wardboard-collector/`, and nothing else. |
| `--config <file>` | Use another directory layout config (default `tools/collector/config/directory.json`). |
| `--headless` | Run without a window. For automated tests only: **do not use it for a real run**, because you cannot sign in without a window. |

```sh
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --resume
pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --cleanup
```

Exit codes: `0` success, `1` collection failed or cancelled, `2` bad arguments
or a refused staging folder.

## What the bundle contains

After a successful run, `<dir>/wardboard-collector/bundle/` holds:

- one file per individual portrait, named by the SHA-256 of its bytes
  (`<sha256>.jpg` or `.png`); identical images are stored once;
- `manifest.json`: the member names that go with each portrait file, the
  members with no portrait (`"reason": "none"`) or whose image could not be
  fetched after the configured retries (`"reason": "failed"`), and the number
  of household images that were skipped. Members who share a name are all kept
  and marked `"duplicateName": true`.

Household photos are never downloaded and never substituted for a portrait.
The collector reads only member names and portrait images. It does not keep
addresses, phone numbers, email addresses, birth dates, Church record numbers,
links, page HTML or page captures, cookies, tokens or URLs. Running it twice
over the same directory produces the same `manifest.json`.

`<dir>/wardboard-collector/state.json` records progress (household positions,
not names or links), the collected names and the files the collector wrote, so
that `--resume` and `--cleanup` work. Successful runs keep the bundle: it is
yours to hand off. Do not commit it or share it.

## Cleanup

`--cleanup` deletes only the files recorded in `state.json` (portraits,
`manifest.json`, `state.json` and temporary files), then the `bundle` and
`wardboard-collector` folders if they are empty. Anything else you put in
`wardboard-collector/` is left in place and reported as a count; nothing
outside it is touched. If a file cannot be deleted, the collector says how many
and exits 1; fix the permissions and run `--cleanup` again.

## Limits

- **The selectors are unverified.** `config/directory.json` holds a best guess
  at the real directory's page structure. If a run stops with
  `Unsupported directory layout (expected directory-v1). Nothing was imported.`,
  the selectors need updating; the collector never guesses.
- **Bringing a bundle into WardBoard is not available yet.** For now the
  collector only produces the bundle. Uploading a portrait to a member in the
  app works independently.

## Development

```sh
pnpm --filter @wardboard/collector test       # real headless Chromium against a fictional local directory
pnpm --filter @wardboard/collector typecheck
pnpm --filter @wardboard/collector lint
```

The tests use only the fictional directory in `test/support/`, with generated
images and canary values that must never reach staging or output. Never add
real member data, photos or directory pages to this package.
