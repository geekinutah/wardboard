# GUI verification

WardBoard runs in desktop browsers and phone browsers, plus a presentation mode for a laptop driving a TV. Every UI-touching task (anything under `apps/web/src/`) must be rendered and looked at, not just unit tested. This document is the procedure implementers and verifiers follow; `AGENTS.md` makes it mandatory.

> **Status:** the pipeline described here exists (built by T-003, web skeleton and e2e harness). `pnpm --filter web run gui:capture` runs it; the first scenario is `shell` (`apps/web/e2e/gui/shell.capture.ts`). The capture server is seeded with the fictional fixture ward (T-068).

## Viewports

Each contract names the viewports it changes. Verify every one it names.

| Name | Browser | Size (CSS px) | Playwright settings | Covers |
|---|---|---|---|---|
| `desktop` | Chromium | 1440 × 900 | default | Desktop board, dialogs, settings |
| `phone` | Chromium **and** WebKit | 390 × 844 | `isMobile: true`, `hasTouch: true`, `deviceScaleFactor: 3` | Phone layout, bottom tabs, sheets, tap-to-move |
| `tv` | Chromium | 1920 × 1080 | default | Presentation mode on an office TV |

The phone viewport runs in both engines because bishopric members use iPhones, whose browsers all run WebKit (Safari's engine). A phone scenario passes only when it passes and looks right in both. WebKit in Playwright is not a real iPhone; how it feels on an actual phone remains a human check.

## Pipeline

1. **Start a checkout-scoped app.** `pnpm --filter web run gui:capture` starts the server on an ephemeral port with a temporary data directory seeded from the fictional fixture ward, serves the web build, and runs the capture scenarios. The server, port and data directory are not shared between worktrees, so concurrent runs in separate worktrees do not collide. Playwright itself runs under `scripts/e2e-slot.pl`, which takes one of the machine-wide slots (2 slots of 6 workers, lock files in `/tmp/wardboard-e2e-slots`) shared by every capture and e2e run on the machine; when both slots are busy, the run prints `e2e-slot: all 2 slots busy, waiting` and starts once one frees. Run ad-hoc Playwright commands through the wrapper too, without a `--workers`/`-j` flag (the wrapper adds it), for example `cd apps/web && ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts e2e/editing.spec.ts`.
2. **Drive real interaction.** Capture scenarios live in `apps/web/e2e/gui/`. Use real Playwright input: clicks, `dragTo` or mouse down/move/up for drag and drop, touch taps on the phone viewport, keyboard for zoom shortcuts and Esc. Never set component state directly to reach a screen.
3. **Capture.** Screenshots go to `apps/web/gui-artifacts/<scenario>/<viewport>-<browser>.png` (gitignored). Capture each changed state: before and after an action, every dialog or sheet, every zoom level the task touches.
4. **Look.** Open every captured image with the harness's image-viewing capability and compare it with the matching artboard in `docs/design/` (artboard numbers are listed in `docs/design/README.md`). A screenshot path in a report is not evidence that anyone looked at it.
5. **Record.** In the report, list each scenario and viewport, the screenshots inspected, and what was checked. Keep large images as artifact paths.

If image viewing, Chromium, WebKit, or the capture command is unavailable, report BLOCKED with the missing capability. Do not substitute DOM assertions or test output for looking at the screen.

## What counts as a real finding

A finding is a bug when it contradicts the task's acceptance criteria, `SPEC.md`, the rules in `docs/design/README.md`, or correctness of the changed behavior. Examples:

- Overlap or clipping of text, cards, dialogs, or sheets.
- Horizontal scrolling at the phone viewport.
- A state change that is not visible (selected, dragging, drop target, proposed, vacant, removed).
- Color used as the only signal (a vacancy without the word "Vacant", a release without "−").
- Touch targets under 44 px at the phone viewport.
- Notes visible anywhere other than the opened notes view, or Needs approval visible on the TV while the Admin setting is off.
- The persistent search bar missing from a desktop screen.

These are not bugs on their own: spacing, color, or wording you would personally choose differently when the design and `SPEC.md` say nothing about it. Report those as notes, not FAILs.
