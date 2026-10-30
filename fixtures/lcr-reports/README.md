# LCR report fixtures

Anonymized copies of the four official Church report PDFs that WardBoard imports (SPEC §15). They keep the real reports' exact layout, so the importer's parsers (T-053–T-055) can be tested against what LCR actually produces.

| File | Source report | Pages |
|---|---|---|
| `organizations-and-callings.pdf` | Callings → Callings by Organization → Print (with member rosters included) | 25 |
| `members-without-callings.pdf` | Reports → Members without Callings → Print | 4 |
| `out-of-unit-callings.pdf` | Reports → Out-of-Unit Callings → Print | 1 |
| `member-list.pdf` | Reports → Member List → Print → Download PDF (unconfirmed: Mike called this report "Member Directory") | 7 |

Generated October 25, 2026 from one ward's reports and reviewed by Mike before commit.

### `member-list.pdf` provenance

- Mike supplied the layout on 2026-10-29 (title, unit line, columns, repeated header, footer, 45 rows on page 1 and 48 on later pages, final `Count:` row).
- The rows were rewritten by hand to the existing fictional identities: one row for every person printed in the other three files (including the under-11 children those files print), alphabetical by printed name. Age, birth date, gender, phone and email are copied from those files; birth dates use the `DD Mon YYYY` form and agree with the age as of the footer date, 25 Oct 2026.
- The content streams were re-encoded with `FlateDecode` only, so the importer's reader can read them; ReportLab metadata was removed.
- `Westdale, Gus` is printed twice in the existing fixtures: as a 39-year-old in Members without Callings and the Elders Quorum roster, and as an 11-year-old Teachers Quorum President in Callings by Organization. Real reports can't do this. The Member List has exactly one row for him, with the age 39 printed in Members without Callings. The other fixtures are unchanged.
- `Fairwell, Sage Casey Kendall Reagan` is also printed with two different ages (16 and 14) in Callings by Organization; the Member List uses the age 14 row.

## What is fictional

- Every person's name, age, birth date, phone number and email. Each person has one consistent fake identity across all the files, so cross-report matching can be tested.
- Fake ages stay in the person's original band (adult 18+, youth 11–17, child under 11), birth dates agree with the fake ages as of 25 Oct 2026, and fake first names agree with the listed gender.
- Phone numbers use the 555 prefix; emails use `example.com`.
- The ward and stake names and unit numbers (`Cedar 14th Ward (100001)`, `Cedar Utah Stake (200002)`), and every unit listed under "Serving in Unit".
- Document metadata.

## What is real

Report structure: page layout, fonts, section and group headers, calling titles, "Calling Vacant" markers, counts, sustained dates, set-apart checks, footnotes, and two names that wrap onto a second line. Treat these as the layout contract the parsers must handle.

## Rules

- These are the only report-shaped fixtures that may be committed. Never add real reports, real names, or other harvested data (AGENTS.md security rules).
- Don't edit these PDFs by hand. If LCR's layout changes, Mike provides new reports and they are re-anonymized the same way.
