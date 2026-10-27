# T-070: Preview harness for standalone board views

**Milestone:** 4 — Desktop board (developer tooling)
**Depends on:** T-003, T-004, T-007 (all done). No shared files with T-029, T-031 or T-068.
**Spec refs:**
- SPEC.md §9: fictional data only.
- AGENTS.md § GUI verification: UI work is rendered and screenshotted in a real browser.
- `docs/gui-verification.md`.

## Goal
`/__preview/<name>` renders any feature's standalone preview with the fictional fixture ward and a fixture proposal that already contains changes. The level views (T-032, T-033, T-034) can then be built and GUI-verified before the app shell (T-030) mounts them. `/__preview` lists every preview as a link.

## Design decisions (binding)
- **Routing** lives in `apps/web/src/main.tsx` and does not touch `App.tsx`, which T-029 owns.
  - If `location.pathname === '/__preview'` or starts with `'/__preview/'`, render `<PreviewApp />` (from `src/preview/PreviewApp.tsx`, loaded with `React.lazy` + dynamic `import()`). Otherwise render `<App />` exactly as today.
  - Fixture data and preview modules are therefore only in lazy chunks, never in the main chunk.
- **Discovery**: `import.meta.glob('../features/*/preview.tsx')`, lazy. A preview module default-exports:
  ```ts
  export type PreviewModule = { title: string; render: (data: PreviewData) => ReactNode };
  ```
  The URL name is the feature folder name: `features/ward-overview/preview.tsx` → `/__preview/ward-overview`. No registry file to edit, so parallel tasks never conflict.
- **`PreviewData`** (`src/preview/data.ts`) is built once, deterministically:
  ```ts
  export type PreviewData = { ward: Ward; current: Board; proposal: Proposal };
  ```
  - `current` and `ward` come from `buildFixtureWard()`.
  - `proposal` is `buildFixtureProposal(current, ward)`, with its board replaced by the result of applying, through the real core operations, in this order:
    1. `releaseCalling` on one occupied Primary position.
    2. `placeInPosition` of a dugout member into one vacant Relief Society position.
    3. `addListPosition` on one list assignment in Sunday School.
  - The exact positions are chosen by the implementer and named in a comment.
  - A thrown or failed operation throws with a clear message, so a fixture change can't silently produce a preview without changes.
  - `ids` come from `sequentialIds('preview')`.
- **`/__preview` index**: an `<h1>Previews</h1>` and a list of links, `<a href="/__preview/<name>">title</a>`, sorted by name. With zero preview modules it shows the text "No previews yet."
- **Unknown name**: shows "No preview named <name>." with a link back to the index. It never throws.
- **Layout**: the preview area is the full viewport below a 48 px bar that shows the preview title and an "All previews" link. It uses token colors only.
- **Preview modules may import** from `@wardboard/core/fixtures` only through `PreviewData`; they receive the data as an argument.

## Scope
May change:
- `apps/web/src/main.tsx` (routing branch only)
- `apps/web/src/preview/**` (new)
- `apps/web/package.json` and `pnpm-lock.yaml`: add `@wardboard/core: "workspace:*"` if not already present. T-029 adds the same line; the controller resolves the conflict at merge.
- `apps/web/e2e/preview.spec.ts`, `apps/web/e2e/gui/preview.capture.ts` (new)

Must not change:
- `apps/web/src/App.tsx`, `apps/web/src/sync/**`, `apps/web/src/design/**`, `apps/web/src/features/**`, `apps/web/vite.config.ts`, existing e2e files, `apps/server/**`, `packages/**`, and anything else

New dependencies allowed: `@wardboard/core` (workspace) only.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Data and harness tests | `pnpm --filter @wardboard/web exec vitest run src/preview` | all pass |
| 2 | Fixtures stay out of the main chunk | `pnpm --filter @wardboard/web run build && node -e "const fs=require('fs');const m=fs.readFileSync('apps/web/dist/index.html','utf8').match(/assets\/index-[^\"]+\.js/)[0];process.exit(fs.readFileSync('apps/web/dist/'+m,'utf8').includes('Ada Fictional')?1:0)"` | exit 0 |
| 3 | e2e | `pnpm --filter web run test:e2e` | all projects pass, including `preview.spec.ts` |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/preview/<project>.png` (the index) for desktop and TV, inspected |
| 5 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `preview data proposal differs from its baseline` | `proposalDiff(proposal)` has ≥1 calling, ≥1 release, ≥1 added position | ops not applied, or applied to the baseline |
| `preview data is deterministic` | two builds `toEqual` | random ids |
| `preview data current is untouched` | `current` equals `buildFixtureWard().current` | ops applied to current |
| `index lists previews sorted and handles none` | injected module map (the harness takes the glob result as a prop for testing) → sorted links; empty → "No previews yet." | — |
| `known name renders the module with the data` | — | data not passed |
| `unknown name shows the not-found message` | — | throws |
| `non-preview paths render App` | `/` → the App shell text (`WardBoard`) | the preview branch catches everything |

`e2e/preview.spec.ts`:
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `preview index loads behind the gate and the app root is unchanged` | `/__preview` shows "Previews"; `/` still shows "Server: ok" | broken routing in the real build |

## Edge cases (each needs a test)
Covered above: zero previews, an unknown name, a fixture op that fails (unit test: an injected failing op makes the builder throw with the message), and a non-preview path.

## GUI verification
Required. This task changes `apps/web/src/**`. Capture the index at desktop and TV. At the phone projects, capture once to check for no horizontal scroll.

## Human checks
none

## Out of scope
- Any feature preview. T-032 to T-034 add their own `preview.tsx`.
- The sync layer.
- Changes to `App.tsx`.
