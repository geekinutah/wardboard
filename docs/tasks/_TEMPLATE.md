# T-###: <short title>

**Milestone:** <number and name from SPEC.md §16>
**Depends on:** <task ids that must be done first, or "none">
**Spec refs:** <SPEC.md sections>

## Goal
<One or two sentences: the behavior that will exist after this task.>

## Scope
May change:
- <paths>

Must not change:
- <paths or "anything else">

New dependencies allowed: <list, or "none">

## Acceptance criteria
Each must be a command or test with an exact expected result.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | <what it proves> | `pnpm --filter core test -- deck` | all tests in `deck.test.ts` pass |
| 2 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `deals N unique tasks per press` | <...> | <e.g. dealing with replacement> |

## Edge cases (each needs a test)
- <empty list>
- <fewer tasks than N>
- <...>

## Human checks
<Subjective checks Mike does on a device, with exact steps. "none" if not applicable.>

## Out of scope
- <things the implementer must not do in this task>
