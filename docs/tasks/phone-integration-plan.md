# Phone, photos and import integration plan

The phone screens (T-047–T-051), the import preview (T-059) and photo upload and comparison (T-060) were built as standalone previews at `/__preview/<name>`. The real app at `/` still shows only the desktop shell, and stored portraits are never displayed. This wave wires them into the app, like the desktop wave in [`integration-plan.md`](./integration-plan.md). Mike approved the approach on 2026-10-28: the phone layout is chosen by width at `/`, and existing specs that drive the desktop shell at phone width load `/?layout=desktop`.

A task appears in [`STATUS.md`](./STATUS.md) once its contract is written. IDs below T-094 are planned, not yet contracted.

| ID | Title | Depends on | Scope (summary) | Done when |
|---|---|---|---|---|
| T-061 | Directory photo collector | T-060 | `tools/collector/` | Contracted. Local Playwright command producing a names-and-portraits bundle (decisions in the contract) |
| T-092 | Phone layout at the app root, with the Board tab | T-047, T-048 | `App.tsx`, `shell/` layout files, `goto('/')` lines in e2e | Contracted |
| T-093 | Portrait and photo upload in the desktop person inspector | T-060, T-078 | `features/photos`, `features/person`, `PersonPanel.tsx` | Contracted |
| T-094 | Phone person and move sheets, add position | T-092, T-049 | `shell/PhoneApp.tsx`, phone-person wiring | Tapping a person or vacancy on the phone Board tab opens the T-049 sheets against live sync; moves and fills apply as operations; phone profile sheet shows the portrait and offers upload |
| T-095 | Phone search and dugout tabs | T-092, T-050 | `shell/PhoneApp.tsx` (tab wiring) | Search and Dugout tabs replace their placeholders and open the person sheet |
| T-096 | Phone changes tab and Accept | T-092, T-051 | `shell/PhoneApp.tsx` (tab wiring) | Changes tab replaces its placeholder, including Accept for a Draft |
| T-097 | Import screen in Settings | T-059, T-080 | `shell/SettingsRoute.tsx`, `features/import` wiring | Admins upload the three PDFs, review the T-059 preview, and replace Current in the app; Editors don't see it |
| T-098 | Photo bundle import | T-061, T-093 | server bundle route, `features/photos` wiring | An Editor picks a collector bundle; names match against the ward with confirmation for namesakes; first photos apply; replacements go through the one-at-a-time comparison; collector cleanup is offered after handoff |
| T-099 | Import guide and operator prompt for the shipped collector | T-061, T-098 | `docs/import/` | The guide's version line and steps describe the shipped collector with real commands, and the structural tests are updated by contract |
| T-100 | Portraits on cards, dugout and presentation | T-093 | `design/PersonContent.tsx` and callers | Cards show a stored portrait instead of initials wherever SPEC shows a face, including leadership photos in presentation mode |

T-094, T-095 and T-096 all edit `shell/PhoneApp.tsx`, so they run one after another. T-097 and T-100 can run alongside them.
