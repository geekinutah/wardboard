# LCR report fixtures

Anonymized copies of the three official Church report PDFs that WardBoard imports (SPEC §15). They keep the real reports' exact layout, so the importer's parsers (T-053–T-055) can be tested against what LCR actually produces.

| File | Source report | Pages |
|---|---|---|
| `organizations-and-callings.pdf` | Callings → Callings by Organization → Print (with member rosters included) | 25 |
| `members-without-callings.pdf` | Reports → Members without Callings → Print | 4 |
| `out-of-unit-callings.pdf` | Reports → Out-of-Unit Callings → Print | 1 |

Generated October 25, 2026 from one ward's reports and reviewed by Mike before commit.

## What is fictional

- Every person's name, age, birth date, phone number and email. Each person has one consistent fake identity across all three files, so cross-report matching can be tested.
- Fake ages stay in the person's original band (adult 18+, youth 11–17, child under 11), birth dates agree with the fake ages as of 25 Oct 2026, and fake first names agree with the listed gender.
- Phone numbers use the 555 prefix; emails use `example.com`.
- The ward and stake names and unit numbers (`Cedar 14th Ward (100001)`, `Cedar Utah Stake (200002)`), and every unit listed under "Serving in Unit".
- Document metadata.

## What is real

Report structure: page layout, fonts, section and group headers, calling titles, "Calling Vacant" markers, counts, sustained dates, set-apart checks, footnotes, and two names that wrap onto a second line. Treat these as the layout contract the parsers must handle.

## Rules

- These are the only report-shaped fixtures that may be committed. Never add real reports, real names, or other harvested data (AGENTS.md security rules).
- Don't edit these PDFs by hand. If LCR's layout changes, Mike provides new reports and they are re-anonymized the same way.
