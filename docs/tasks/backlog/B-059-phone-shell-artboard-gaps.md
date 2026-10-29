# B-059: The phone shell lacks artboard elements: Live indicator, proposal options, switcher footnote

**Priority:** P3  
**Area:** web phone shell  
**State:** candidate  
**Found:** 2026-10-28, T-092 implementer and verifier  
**Promoted to:** —

## Finding

`PhoneHome.dc.html` shows a `Live` connection indicator in the header. `PhoneTabs.dc.html` shows an `Options for …` button on each proposal row and the footnote "Each person picks their own board…". The T-047 `PhoneShell` has none of these. On the phone, sync state is visible only through `SyncBanner` when the app is not live.

## Risk

Phone users can't see at a glance that they are live, and there are no per-proposal actions on phones.

## Direction

Add a connection indicator to the phone header (reusing the desktop's `ConnectionIndicator` semantics) and the switcher footnote. Decide with T-094–T-096 what proposal options belong on phones (rename, archive, and so on, per SPEC).

## Evidence

- T-092 GUI captures `apps/web/gui-artifacts/phone-app/*` compared with `docs/design/ui-canvas/PhoneHome.dc.html` and `PhoneTabs.dc.html`; docs/tasks/evidence/T-092.md
