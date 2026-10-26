# WardBoard

A private, self-hosted visual board that helps a ward bishopric discuss and explore changes to callings — inspired by a mission transfer board. It is planning software only: callings are extended, sustained, set apart, released and recorded in the Church's official tools.

- **Product spec:** [`SPEC.md`](SPEC.md)
- **Design guidance:** [`docs/design/`](docs/design/README.md)
- **How agents build this repo:** [`AGENTS.md`](AGENTS.md) and [`docs/agents/`](docs/agents/README.md)
- **Task plan and status:** [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md), [`docs/tasks/STATUS.md`](docs/tasks/STATUS.md)
- **Needs a human:** [`HUMAN_BACKLOG.md`](HUMAN_BACKLOG.md)

Stack: TypeScript pnpm monorepo, Node server with WebSocket + SQLite, React web client, Docker, reachable only over Tailscale. All names and data in this repository are fictional.
