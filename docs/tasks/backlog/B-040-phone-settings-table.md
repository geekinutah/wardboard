# B-040: Settings user-row actions overflow on phones with no scroll cue

**Priority:** P2  
**Area:** web settings / phone layout  
**State:** candidate  
**Found:** 2026-10-28, T-080 implementer and verifier  
**Promoted to:** —

## Finding

At 390px, `.wb-settings-table { min-width: 560px }` (`apps/web/src/features/settings/settings.css:197-205`) sits inside an `overflow-x: auto` wrapper. The Admin badge and the role and remove buttons run past the card edge, and nothing shows that the row scrolls sideways. This predates T-080; the T-046 preview capture shows it too.

## Risk

On a phone, an admin may not find role changes or Remove access (SPEC §2).

## Direction

At phone widths, stack each user's actions under the name, either in the phone-layout task or in a small settings follow-up.

## Evidence

- `apps/web/gui-artifacts/settings-route/admin-page-phone-*.png`, `gui-artifacts/settings/admin-phone-webkit.png`; `docs/tasks/evidence/T-080.md`
