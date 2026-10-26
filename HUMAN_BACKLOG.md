# Human backlog

Work that **cannot** be finished by an agent: accounts, decisions, Church guidance, hardware, and secrets. Agent-executable work stays in [`docs/tasks/BACKLOG.md`](docs/tasks/BACKLOG.md) and [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md). Task ledger: [`docs/tasks/STATUS.md`](docs/tasks/STATUS.md). Only add content here that a human needs to read. You can cross-reference from the Human Backlog to the Agent backlog IDs, but never from Agent backlog to Human Backlog IDs. Human backlog is subject to human whims and the IDs could disappear or be re-numbered. Instead, just reference the Human backlog as a whole thing instead of a specific ID.

---

## Human Needed

| # | What | Why an agent stopped | What to do |
|---|---|---|---|
| 1 | ~~Sign-in method~~ **DONE 2026-10-25** | — | Tailscale identity via `tailscale serve`, behind a replaceable identity-provider module (SPEC §10). |
| 2 | ~~Youth/adult mapping rule~~ **DONE 2026-10-25** | — | Adult 18+, youth 11–17, under 11 not imported (SPEC §15). |
| 3 | Identity source-key policy | SPEC §15: identity keys are collected only after the policy is settled. | Decide whether any source key may be stored, and which. |
| 4 | ~~Church guidance on data handling~~ **Reviewed 2026-10-25** | SPEC §9: confirm storage, access, photo use and export against applicable Church guidance before real data is used. | Review before the first real import. |
| 5 | ~~Directory photo collection~~ **Confirmed acceptable 2026-10-25** | — | T-061 may be promoted. |
| 6 | Anonymized PDF samples | Parsers must be tested on fixtures that match real layouts without real member data. | In progress: Mike has the three ward reports; anonymize them locally, then Mike reviews before anything is committed. |
| 7 | Tailscale and Mac Studio | Account and device setup. | Needed for T-063 and first install. Counselors asked to install Tailscale (2026-10-25); invite them to the machine and expose the service once it runs. Give each counselor tailnet access to the Mac Studio (tailnet member or machine sharing), confirm your Tailscale plan covers it, and confirm their requests carry identity headers. |
