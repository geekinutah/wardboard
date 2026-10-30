# B-069: Members who hold callings arrive without youth/adult

**Priority:** P2  
**Area:** import  
**State:** accepted  
**Found:** 2026-10-29, Mike, first-import walkthrough ("I didn't have birthdate or age data for 146 of the 260 people")  
**Promoted to:** T-111, T-112 (Mike, 2026-10-29: option (a), the Member List report; 2026-10-30: required, not optional)

## Finding

Only the Members without Callings report carries ages (`packages/importer/src/reports/without-callings.ts` `categoryForAge`). Everyone who holds a calling appears only in Callings by Organization, which has no ages. So the review asks the Admin to choose Adult or Youth for each of them.

## Risk

The first import is slow, and a mistaken choice puts a youth in an adult category, or the reverse.

## Direction

Options for Mike:
- (a) Add an optional fourth report, the LCR Member List. It is used only to derive youth/adult; age and birth date are discarded before storage. This needs a SPEC §15 change, a parser, and an anonymized fixture PDF from Mike.
- (b) Add a bulk "mark remaining as Adult" in the review (overlaps B-062).
- (c) Both.

## Evidence

- `packages/importer/src/reports/without-callings.ts:40`, `apps/server/src/import/plan.ts:150-161`
