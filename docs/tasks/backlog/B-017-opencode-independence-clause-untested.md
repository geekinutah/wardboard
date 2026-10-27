# B-017: OpenCode model test doesn't pin the "independence is a fresh session, not a different model" wording

**Priority:** P2  
**Area:** agent docs (OpenCode)  
**State:** candidate  
**Found:** 2026-10-26, T-065 round 2 verifier  
**Promoted to:** —

## Finding

`scripts/opencode-model.test.mjs` checks the OpenCode controller's independence point only with `/fresh verifier/i`. Rewording `.opencode/agents/controller.md` to "…a fresh verifier session and a different model" still passes.

## Risk

A later edit could imply OpenCode needs a second model for verification, which contradicts the pin and could push a controller toward unconfigured providers again.

## Direction

Assert the clause negates model difference (e.g. "not a different model"), or forbid "different model" phrasing other than in that negation.

## Evidence

- T-065 verifier mutation table (`docs/tasks/evidence/T-065.md`).
