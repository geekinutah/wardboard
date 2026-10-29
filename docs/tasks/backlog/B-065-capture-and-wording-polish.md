# B-065: Small wording and capture follow-ups from the T-094/T-097/T-100 wave

**Priority:** P3  
**Area:** web phone / e2e  
**State:** candidate  
**Found:** 2026-10-29, T-094, T-097, T-100 and T-103 verifier reports  
**Promoted to:** —

## Finding

- `PhoneFillSheet.tsx` chooses its empty message from the query alone: a non-blank query on an empty dugout says `No matching people.`, and a list whose dugout members are all already in it says `No one in the dugout.`.
- The T-097 e2e step 4 detects the second client's update by a whole-body `innerText` difference rather than a specific card.
- The desktop presentation GUI capture crops the title row at the top.
- On the first-import setup page (T-103), the reused Import section says "Replace Current with the three LCR reports" although no Current exists yet, and each chosen file name shows twice (native input plus caption).

## Risk

Cosmetic wording; a looser-than-needed e2e assertion; a capture that hides part of the screen from GUI review.

## Direction

Pick the fill-sheet message from whether there are any unfiltered candidates; assert a named member/card in `import-settings.spec.ts`; capture the full presentation title on desktop; use first-import wording in `ImportSection` when `current === null` and show each file name once.

## Evidence

- `docs/tasks/evidence/T-094.md`, `T-097.md`, `T-100.md` (verifier notes)
