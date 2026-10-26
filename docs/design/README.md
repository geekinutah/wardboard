# WardBoard design guidance

This folder is the visual reference for building WardBoard. `SPEC.md` is the source of truth for behavior; these designs show how that behavior should look. When a design and `SPEC.md` disagree, `SPEC.md` wins and the difference should be reported.

- `ui-canvas/` holds the source of every artboard from the design canvas (`canvas.json` is the index; each `*.dc.html` file is one artboard). The files use a design-canvas runtime and will not render on their own in a browser, but the markup carries exact colors, sizes, spacing and copy, and is meant to be read.
- All names and numbers in the designs are fictional. Bracketed text such as `[Short planning note — 280 characters max]` is a placeholder, not copy.

## Visual language

**Look:** calm and utilitarian — stone ground, ink text, one deep-teal accent. No Church branding, no gradients, no emoji.

**Type:** IBM Plex Sans (400/500/600/700) for everything; IBM Plex Mono (500) for counts and diff lines. Section labels are 11–12px, 600, uppercase, letter-spaced 0.06em.

**Color tokens**

| Token | Hex | Use |
|---|---|---|
| ground | `#F3F4F1` | App background; canvas has a `#D3D7D1` 1px dot grid every 22px |
| surface | `#FFFFFF` | Cards, panels, header |
| ink | `#18212B` | Primary text |
| ink-2 | `#3A444F` | Secondary text |
| muted | `#55606B` | Tertiary text (passes 4.5:1 on white) |
| line | `#D9DDD8` | Borders; `#E1E4DF` / `#ECEEEA` for inner dividers |
| accent | `#1D5C68` | Proposal state, selected tab, primary buttons; soft `#E3EEEF`, dark `#123E47` |
| vacancy | `#8A4209` text, `#C9772E` dashed border, `#FFF8F1`/`#FBEFE3` fill | Vacant positions — always dashed and labeled "Vacant" |
| proposed | `#1F4E99` text, `#E6EDF8`/`#F3F7FD` fill | "+ Proposed" / suggested callings |
| release | `#3A444F` on `#ECEEEA`, struck-through | "−" suggested releases |
| needs approval | `#5B2B6E` on `#F2EAF5`, lock icon | The `needs_approval` member property |
| removed | grey cross-hatch `repeating-linear-gradient(135deg, #E6E8E5 0 6px, #F4F5F3 6px 12px)`, dashed `#8A929A` border, faint rotated REMOVED / POSITION REMOVED watermark | Members/positions no longer in Current |
| accepted | `#2E5B3A` | ACCEPTED status badge |
| TV | `#10171E` ground, `#18222C` cards | Presentation mode only |

**Rules that matter**

- Never rely on color alone: vacancies say "Vacant", proposed items say "+ Proposed", releases use "−" and strikethrough, removed items carry text as well as the hatch and watermark.
- Touch targets are at least 44px. Use real `<button>`, `<a href>`, `<input>` + `<label>`.
- Photos are placeholders (initials on a colored circle) until real portraits exist; a vacant slot is a dashed circle.
- No explanatory filler text. If a behavior is obvious from the UI, don't add a sentence explaining it.

## Artboards

| # | File | Shows | Key decisions |
|---|---|---|---|
| 1 | `Main.dc.html` | Ward overview (zoom level 1) on a proposal tab | Header: brand, board tabs, persistent search, presence, account. Status strip: PROPOSED badge, baseline date, +callings / −releases / vacant counts, Live indicator. Dugout panel on the right. |
| 2 | `OrgDetail.dc.html` | Relief Society detail mid-drag | Single vs list destinations, affinity match on the drag ghost, inspector for a person with multiple callings, dugout tray as a drop target. |
| 3 | `DropDialog.dc.html` | Drop on an occupied single calling | Swap / Release occupant / Cancel, each describing its exact result. |
| 4 | `Approval.dc.html` | Needs-approval placement | Approval is specific to member, position and proposal. |
| 5 | `Mobile.dc.html` | Phone tap-to-move sheet | Vacant destinations, preferred-tag match, Send to dugout. |
| 6 | `Presentation.dc.html` | TV mode (1920×1080) | Large type, leader photos, ring marks proposed changes. |
| 7 | `Summary.dc.html` | Proposal summary | Collapsible diff of Current changes since baseline; suggested callings, releases, position changes, remaining vacancies; CSV. No printing. |
| 8 | `Import.dc.html` | Import preview | Validated sources, counts, identity decisions, discarded fields, gated replace. |
| 9 | `Removed.dc.html` | Removed member and position | Only additions: hatch + watermark on cards, diff summary at top, Accept disabled. Normal editing otherwise. |
| 10 | `Tags.dc.html` | Tags and calling affinities | Member tags (ward-wide), Needs approval as a separate member setting, calling tags + preferences (per board), tag library with delete confirmation. |
| 11 | `Search.dc.html` | Search and filters | Grouped results, scope switch, filter chips highlight without editing, Add to dugout per person. |
| 12 | `Confirm.dc.html` | Second-calling confirmation | Cites Handbook 30.1.1. Presidency releases have no confirmation. |
| 13 | `AddPosition.dc.html` | + on a group | Title, single/list, count; adds to the edited board only. + Add group. |
| 14 | `PhotoCompare.dc.html` | Photo replacement | Current vs incoming, Keep Current / Use New Photo, batch progress. |
| 15 | `StartProposal.dc.html` | Current read-only + Start proposal | No drag on Current; Start proposal button opens from-Current/duplicate dialog. |
| 16 | `Aaronic.dc.html` | Aaronic Priesthood | Bishop as fixed linked card in priests quorum; "Overseen by" on each quorum, editable for counselors. |
| 17 | `Zoom.dc.html` | Three zoom levels | Ward → Organization → Group; double-click/scroll/pinch in, zoom-out/Esc/scroll out, Fit ward; double-click on a member opens notes. |
| 18 | `Settings.dc.html` | Settings | People & access (last-admin protection), one presentation setting (Show Needs approval, Admins only), backup & restore with validation. |
| 19–25 | `Phone*.dc.html` | Phone set | Bottom tabs (Board, Search, Dugout, Changes); zoom levels become tap-through screens; person sheet offers Move / Release per calling and Add to dugout; changes screen with blocked Accept; board switcher with Start proposal. |
| 26 | `Accepted.dc.html` | Accepted proposal | Status selector (Accepted read-only ↔ Draft), past accepted list, plain-text callings/releases per bishopric member (and an Elders Quorum presidency block for the stake presidency) with Copy buttons. |
