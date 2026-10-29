# B-063: The Admin badge in People & access is clipped at phone width

**Priority:** P3  
**Area:** web settings  
**State:** candidate  
**Found:** 2026-10-29, T-097 verifier (GUI capture)  
**Promoted to:** —

## Finding

At 390px, the People & access row clips its Admin badge to "Adm".

## Risk

Role text is cut off on phones, so an Admin can't read who holds which role.

## Direction

Check the access rows' flex/overflow rules in the Settings phone layout so the badge wraps or keeps its width.

## Evidence

- `apps/web/gui-artifacts/import-settings/sources-phone-chromium.png` (T-097 capture)
- `apps/web/src/features/settings/`
