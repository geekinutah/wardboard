# Human backlog

Work that **cannot** be finished by an agent: accounts, decisions, Church guidance, hardware, and secrets. Agent-executable work stays in [`docs/tasks/BACKLOG.md`](docs/tasks/BACKLOG.md) and [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md). Task ledger: [`docs/tasks/STATUS.md`](docs/tasks/STATUS.md). Only add content here that a human needs to read. You can cross-reference from the Human Backlog to the Agent backlog IDs, but never from Agent backlog to Human Backlog IDs. Human backlog is subject to human whims and the IDs could disappear or be re-numbered. Instead, just reference the Human backlog as a whole thing instead of a specific ID.

---

## Human Needed

| # | What | Why an agent stopped | What to do |
|---|---|---|---|
| 1 | ~~Sign-in method~~ **DONE 2026-10-25** | — | Tailscale identity via `tailscale serve`, behind a replaceable identity-provider module (SPEC §10). |
| 2 | Youth/adult mapping rule | SPEC §15 requires an agreed rule before implementation; blocks T-057. | Define how age (used transiently) maps to youth/adult. |
| 3 | Identity source-key policy | SPEC §15: identity keys are collected only after the policy is settled. | Decide whether any source key may be stored, and which. |
| 4 | Church guidance on data handling | SPEC §9: confirm storage, access, photo use and export against applicable Church guidance before real data is used. | Review before the first real import. |
| 5 | Directory photo collection | SPEC §14–15: automated directory collection is desired, but authorization is unverified; affects T-061. | Confirm it is acceptable before T-061 is promoted. |
| 6 | Fictional/anonymized PDF samples | Parsers must be tested on fixtures that match real layouts without real member data. | Provide or approve anonymized layout samples for T-053–T-055. |
| 7 | Tailscale and Mac Studio | Account and device setup. | Needed for T-063 and first install. Give each counselor tailnet access to the Mac Studio (tailnet member or machine sharing), confirm your Tailscale plan covers it, and confirm their requests carry identity headers. |
