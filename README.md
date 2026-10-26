# WardBoard

A private, self-hosted visual board that helps a ward bishopric discuss and explore changes to callings — inspired by a mission transfer board. It is planning software only: callings are extended, sustained, set apart, released and recorded in the Church's official tools.

- **Product spec:** [`SPEC.md`](SPEC.md)
- **Design guidance:** [`docs/design/`](docs/design/README.md)
- **How agents build this repo:** [`AGENTS.md`](AGENTS.md) and [`docs/agents/`](docs/agents/README.md)
- **Task plan and status:** [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md), [`docs/tasks/STATUS.md`](docs/tasks/STATUS.md)
- **Needs a human:** [`HUMAN_BACKLOG.md`](HUMAN_BACKLOG.md)

Stack: TypeScript pnpm monorepo, Node server with WebSocket + SQLite, React web client, Docker, reachable only over Tailscale. All names and data in this repository are fictional.

## Requirements and setup

The toolchain is declared in machine-readable files; they are the source of truth for versions:

- **Node.js** — the exact version in [`.node-version`](.node-version) (read by fnm, mise, asdf-nodejs and `actions/setup-node`); the accepted range is `engines.node` in [`package.json`](package.json).
- **pnpm** — the version in `packageManager` in [`package.json`](package.json); the accepted range is `engines.pnpm`. Install it with `npm install -g pnpm@<version>` or see <https://pnpm.io/installation> (newer Node releases do not bundle corepack).
- **OrbStack, or any Docker engine** — needed from T-006 (container image) onward.
- **Playwright browsers** — installed by `./scripts/setup.sh` from T-003 onward; nothing to do by hand.

Dependencies are pinned by the committed `pnpm-lock.yaml`; scripts and CI only ever run `pnpm install --frozen-lockfile`. `.npmrc` sets `engine-strict=true`, so pnpm refuses to install with the wrong toolchain.

Quick start from a fresh clone:

```sh
./scripts/setup.sh    # checks the toolchain, then installs dependencies
./scripts/verify.sh   # the quality gate: toolchain, install, script tests, typecheck, lint, unit tests
```

`node scripts/env-check.mjs` checks the toolchain on its own and prints a fix for anything missing or out of range. CI (`.github/workflows/ci.yml`) runs the same two scripts on every push and pull request.
