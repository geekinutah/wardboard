# B-060: Collector hardening follow-ups from T-061

**Priority:** P2  
**Area:** tools/collector  
**State:** candidate  
**Found:** 2026-10-29, T-061 implementer and verifiers (rounds 1–3)  
**Promoted to:** —

## Finding

T-061 shipped with four known gaps, none of which contradicts its contract:
1. The source-boundary tests (`sources()` in `tools/collector/test/staging.test.ts:281-284`) scan only `*.ts`. A `.js`/`.mjs` helper in `src/` escapes the forbidden-API and network-client rules. The runtime observer still caught it in the verifier's X8 mutation.
2. `signedOut` is detected only on page loads. If the session expires during portrait fetches, those portraits are recorded as `failed` instead of prompting a re-sign-in.
3. Bounded retention is enforced only by refusing `--resume` after 7 days. There is no warning or automatic cleanup when a stale collection is left in staging (SPEC §15 "bounded retention policy").
4. If the real directory serves portraits from a CDN host, `context.request.get` fetches from that host by design. The fixture-host test cannot model this. Mike's first real run will show it.

## Risk

Items 1 and 3 weaken the SPEC §15 data-handling guarantees over time. Item 2 produces silently incomplete bundles after a long run.

## Direction

- Scan `*.{ts,mts,cts,js,mjs,cjs}`.
- Check for the signed-out state when a portrait fetch returns HTML or a redirect.
- Warn at startup about collections older than the retention window, and offer cleanup.
- Decide on retention handling together with T-098 (bundle import) and T-099 (guide).

## Evidence

- docs/tasks/evidence/T-061.md (round 1 implementer notes; round 2 and 3 verifier notes)
