# B-051: A failed replacement upload renders its alert under the open comparison dialog

**Priority:** P3
**Area:** web photos
**State:** candidate
**Found:** 2026-10-28, T-060 verifier
**Promoted to:** —

## Finding

When `PhotoUpload` is replacing an existing photo and `upload` or `assign` rejects, the `role="alert"` is rendered under the still-open comparison dialog. A sighted user may not see the message until the dialog closes. The first-photo failure path shows the alert with no dialog, and the success line is still withheld.

## Risk

An Editor can think the replacement is still waiting on a choice after the save has already failed.

## Direction

Show the alert inside the dialog, or close the dialog when the save fails. Do not treat a rejection as success.

## Evidence

- `docs/tasks/evidence/T-060.md`, verifier Notes / blockers, round 1
- `apps/web/src/features/photos/PhotoUpload.tsx`
