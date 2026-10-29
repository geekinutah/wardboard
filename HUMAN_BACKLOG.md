# Human backlog

Work that **cannot** be finished by an agent: accounts, decisions, Church guidance, hardware, and secrets. Agent-executable work stays in [`docs/tasks/BACKLOG.md`](docs/tasks/BACKLOG.md) and [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md). Task ledger: [`docs/tasks/STATUS.md`](docs/tasks/STATUS.md). Only add content here that a human needs to read. You can cross-reference from the Human Backlog to the Agent backlog IDs, but never from Agent backlog to Human Backlog IDs. Human backlog is subject to human whims and the IDs could disappear or be re-numbered. Instead, just reference the Human backlog as a whole thing instead of a specific ID.

---

## Human Needed

| # | What | Why an agent stopped | What to do |
|---|---|---|---|
| 1 | ~~Sign-in method~~ **DONE 2026-10-25** | — | Tailscale identity via `tailscale serve`, behind a replaceable identity-provider module (SPEC §10). |
| 2 | ~~Youth/adult mapping rule~~ **DONE 2026-10-25** | — | Adult 18+, youth 11–17, under 11 not imported (SPEC §15). |
| 3 | ~~Identity source-key policy~~ **DONE 2026-10-25** | — | No Church identifiers; match by name, with confirmation for ambiguous cases (SPEC §8, §15). |
| 4 | ~~Church guidance on data handling~~ **DONE 2026-10-25** | — | Reviewed storage, access, photo use and export against applicable Church guidance (SPEC §9); cleared before real data is used. |
| 5 | ~~Directory photo collection~~ **Confirmed acceptable 2026-10-25** | — | T-061 may be promoted. |
| 6 | ~~Anonymized PDF samples~~ **DONE 2026-10-25** | — | Committed to `fixtures/lcr-reports/` after Mike's review. |
| 7 | Tailscale and Mac Studio | Account and device setup. | Needed for T-063 and first install. Docker engine: OrbStack (decided 2026-10-25; already installed). Counselors asked to install Tailscale (2026-10-25); invite them to the machine and expose the service once it runs. Give each counselor tailnet access to the Mac Studio (tailnet member or machine sharing), confirm your Tailscale plan covers it, and confirm their requests carry identity headers. |
| 8 | Gender and gender-limited callings | Data-model and allow-list change; needs product decisions (see agent backlog B-068). | Decide: source report; how a calling is marked limited (per calling, Handbook defaults by title, or both); what a mismatch does (confirm, refuse, or flag); whether presentation shows it. |
| 9 | Youth/adult for members who hold callings | Only one report carries ages (see agent backlog B-069). | Choose: (a) optional fourth report, Member List, used only for youth/adult; (b) bulk "mark remaining as Adult" in the review; (c) both. For (a), supply an anonymized Member List PDF like the existing fixtures. |
| 10 | Which leaders show on ward tiles | SPEC §4 leaves this OPEN; after T-107 every president and counselor shows (Young Women 12, Aaronic 10). | Decide whether youth class and quorum presidencies appear as tile leaders, or only adult presidencies. |
