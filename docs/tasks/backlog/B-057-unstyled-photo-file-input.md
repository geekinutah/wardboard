# B-057: Photo upload uses the browser's unstyled file input

**Priority:** P3  
**Area:** web photos  
**State:** candidate  
**Found:** 2026-10-28, T-093 implementer and verifier  
**Promoted to:** —

## Finding

`PhotoUpload` (T-060) renders a native `<input type="file">`. In the person inspector it appears as the browser's "Choose File / No file chosen" control next to design-system buttons. The input box meets 44px, but the visible browser button inside it is about 24px tall.

## Risk

It looks inconsistent and is a small target on touch devices. This becomes more visible when T-094 brings upload to the phone profile sheet.

## Direction

Use a design-system `Button`-styled label wrapping a visually hidden input, with a 44px target, and keep the existing accessible label text.

## Evidence

- `apps/web/gui-artifacts/person-photo/placeholder-desktop-chromium.png` (T-093 capture)
- `apps/web/src/features/photos/PhotoUpload.tsx`, `photos.css:62`
