# B-001: Upgrade to TypeScript 7 when typescript-eslint supports it

**Priority:** P2  
**Area:** tooling  
**State:** candidate  
**Found:** 2026-10-25, T-001 implementer and verifier notes  
**Promoted to:** —

## Finding

T-001 pinned `typescript` 6.0.3 although 7.0.2 is the latest, because `typescript-eslint@8.72.0` (latest) declares the peer range `typescript >=4.8.4 <6.1.0`, and the gate requires type-checked lint.

## Risk

The toolchain drifts behind TypeScript; the eventual upgrade gets larger.

## Direction

When a typescript-eslint release supports TS 7, bump both together and run the gate.

## Evidence

- `docs/tasks/evidence/T-001.md` (implementer Notes, verifier judgment point 1)
- `npm view typescript-eslint@8.72.0 peerDependencies`
