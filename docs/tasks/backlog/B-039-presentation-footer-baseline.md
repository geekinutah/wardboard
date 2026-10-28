# B-039: Presentation footer lacks ward name and baseline date (Board model has no capture time)

**Priority:** P3  
**Area:** web presentation / core model  
**State:** candidate  
**Found:** 2026-10-28, T-081 implementer round 1  
**Promoted to:** —

## Finding

Artboard 6 (`Presentation.dc.html`) shows the presentation footer's left slot as "Maple Creek Ward · baseline Oct 19, 2026". In the integrated app that slot renders empty, because the T-081 contract passes `baselineCapturedAt: null` — the `Board` model has no capture or import time field to read, and `Presentation` renders an empty span for `null`.

## Risk

Cosmetic: in TV presentation mode the footer left side is blank next to the "Ring = proposed change" legend, diverging from artboard 6. No data or behavior is lost; the standalone T-045 preview has the same gap.

## Direction

A follow-up task to surface a ward name / baseline date in the presentation footer. Likely needs a model or snapshot change (core/server) to expose a capture/import time — e.g., stamping the baseline board when a proposal is created, or deriving it from the current board's import metadata — then threading it through the shell into the `baselineCapturedAt` prop. Out of scope for T-081.

## Evidence

- T-081 implementer round 1 report: `docs/tasks/evidence/T-081.md` (Notes / blockers).
- `apps/web/src/features/presentation/Presentation.tsx` — `baselineCapturedAt: string | null`, empty footer span when `null`.
- GUI capture `presenting-proposal-tv-chromium.png` (T-081 round 1, `apps/web/gui-artifacts/present-mode/`, gitignored).
