# B-073: Collector README still says bundle import is unavailable

**Priority:** P2
**Area:** collector docs
**State:** candidate
**Found:** 2026-10-31, while contracting T-099
**Promoted to:** —

## Finding

`tools/collector/README.md` says bringing a bundle into WardBoard is not available yet and that the collector only produces the bundle. T-098 shipped the Settings **Directory photos** handoff: select `manifest.json` and the portraits, review matches, apply first photos, compare replacements one at a time, then run `--cleanup`.

## Risk

An operator who follows the collector README will stop after collection and will not know the in-app handoff exists. The human guide is updated by T-099; this README can still contradict it.

## Direction

After T-099, replace the "not available yet" paragraph with the Settings steps and the same `--cleanup` command the app already shows. Do not change collector behavior.

## Evidence

- `tools/collector/README.md` section "Limits": "Bringing a bundle into WardBoard is not available yet."
- `apps/web/src/shell/PhotoBundleSection.tsx` section "Directory photos" and the cleanup command.
- T-098 is `done` in `docs/tasks/STATUS.md`.
