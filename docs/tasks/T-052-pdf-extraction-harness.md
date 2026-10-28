# T-052: PDF extraction harness

**Milestone:** 6 — Import and photos
**Depends on:** T-001 (monorepo bootstrap and quality gate — `done`)
**Spec refs:** SPEC.md §8 (Import and replacement), §14 (Supplied PDF sample inspection; Replacement organization PDF inspection), §15 (Deterministic collection, human instructions, and optional agent assistance), §16 (Milestone 6)

## Goal

Bootstrap the `@wardboard/importer` workspace package (`packages/importer/`) and ship its deterministic, zero-network, zero-LLM PDF text and position extraction harness (`extractPdf` and `groupPageRows`), proven against all three real-layout anonymized LCR report fixtures in `fixtures/lcr-reports/` (multi-page trees, page breaks, wrapped two-line names, mixed calling and member-roster tables, italic vacancy markers, and set-apart checkmarks) as well as small synthetic PDFs for edge cases those fixtures lack.

## Design decisions (binding)

### Package setup (`packages/importer/`)

- `packages/importer/package.json`:
  - `"name": "@wardboard/importer"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`.
  - `"exports": { ".": "./src/index.ts" }`.
  - `"scripts"`: `"test": "vitest run"`, `"typecheck": "tsc -p tsconfig.json"`, `"lint": "eslint . --max-warnings 0"`.
  - `"devDependencies"`: `"vitest": "5.0.5"` (matching `packages/core/package.json`).
  - Zero runtime `"dependencies"` — use Node's built-in `node:zlib` (`inflateSync`) and pure TypeScript. No network or model/LLM dependencies (SPEC §15).
- `packages/importer/tsconfig.json`: extends `../../tsconfig.base.json` with `"include": ["src", "test"]`.
- `docker/Dockerfile`: copy `packages/importer/package.json` into `./packages/importer/package.json` in the runtime stage alongside `packages/core/package.json` so `pnpm install --prod --frozen-lockfile` in `./scripts/docker-smoke.sh` resolves the updated workspace lockfile verbatim.

### Public types and functions (`packages/importer/src/pdf/` and re-exported from `packages/importer/src/index.ts`)

```ts
export type PdfErrorCode = 'EMPTY_PDF' | 'INVALID_PDF' | 'UNSUPPORTED_PDF';

export class PdfParseError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string);
}

export interface PdfTextItem {
  /** Decoded Unicode text of the positioned span. */
  readonly text: string;
  /** Left coordinate in page points from top-left (0, 0), rounded to 2 decimal places. */
  readonly x: number;
  /** Top-down baseline coordinate (height - y_pdf) in page points from top-left (0, 0), rounded to 2 decimal places. */
  readonly y: number;
  /** Effective rendered font size in points after CTM + text-matrix scaling, rounded to 2 decimal places. */
  readonly fontSize: number;
  /** BaseFont name with any 6-uppercase-letter subset prefix (`^[A-Z]{6}+`) stripped, e.g. `LiberationSans`, `LiberationSans-Bold`, `LiberationSans-Italic`, `IPAGothic`, `Helvetica`. */
  readonly fontName: string;
  /** True when `fontName` contains `Bold` (case-insensitive). */
  readonly bold: boolean;
  /** True when `fontName` contains `Italic` or `Oblique` (case-insensitive). */
  readonly italic: boolean;
}

export interface PdfRow {
  /** Representative top-down y coordinate in page points. */
  readonly y: number;
  /** Row items sorted left-to-right by ascending `x`, with vertically wrapped two-line cells merged into a single `PdfTextItem` whose `text` joins the lines with a single space. */
  readonly items: readonly PdfTextItem[];
}

export interface PdfPage {
  /** 1-based page number in document order. */
  readonly pageNumber: number;
  /** Page width in points from `/MediaBox` (inherited from parent `/Pages` when omitted on `/Page`). */
  readonly width: number;
  /** Page height in points from `/MediaBox` (inherited from parent `/Pages` when omitted on `/Page`). */
  readonly height: number;
  /** Positioned text items on this page, sorted top-to-bottom by `y` (1.5 pt line tolerance) then left-to-right by `x`. */
  readonly items: readonly PdfTextItem[];
  /** Reconstructed logical rows (`groupPageRows(items)`). */
  readonly rows: readonly PdfRow[];
}

export interface PdfDocument {
  /** Document `/Title` from the PDF Info dictionary when present, otherwise `null`. */
  readonly title: string | null;
  /** Total number of pages (`pages.length`). */
  readonly pageCount: number;
  /** Extracted pages in 1-based document order. */
  readonly pages: readonly PdfPage[];
}

export function extractPdf(input: Uint8Array): PdfDocument;
export function groupPageRows(items: readonly PdfTextItem[]): PdfRow[];
```

### Extraction and row-grouping rules

1. **Validation and error handling:**
   - If `input.byteLength === 0`, throw `PdfParseError('EMPTY_PDF', ...)`.
   - If the header does not contain `%PDF-`, or no `/Type /Catalog` with a valid `/Pages` root and at least one `/Type /Page` leaf exists, throw `PdfParseError('INVALID_PDF', ...)`.
   - If a page content stream or CMap stream declares an unsupported compression filter (anything other than `/FlateDecode` or uncompressed) or fails `zlib.inflateSync`, throw `PdfParseError('INVALID_PDF', ...)` or `PdfParseError('UNSUPPORTED_PDF', ...)`.
2. **Page tree traversal:**
   - Traverse `/Type /Catalog` → `/Pages` → `/Kids` recursively in array order so multi-level `/Pages` trees (such as the 25-page `organizations-and-callings.pdf`) yield all `/Type /Page` leaf nodes in exact document order (`1..25`).
   - Inherit `/MediaBox` and `/Resources` from ancestor `/Pages` nodes when omitted on a child node.
   - Support `/Contents` on a `/Page` as either a single indirect reference (`N 0 R`) or an array of indirect references (`[N 0 R M 0 R ...]`), concatenating multiple content streams on a page with a newline separator.
3. **Font and ToUnicode decoding:**
   - Parse each page's `/Font` resource dictionary. Strip any subset prefix matching `/^[A-Z]{6}\+/` from `/BaseFont` to produce `fontName`.
   - When a font has a `/ToUnicode` stream, parse both `beginbfchar ... endbfchar` and `beginbfrange ... endbfrange` sections (supporting both `<start> <end> <targetStart>` and `<start> <end> [<t1> <t2> ...]`), including multi-code-unit UTF-16BE target hex strings.
   - Decode `<hex>` strings (2-byte big-endian codes when the font has a `ToUnicode` CMap or `Identity-H` encoding; 1-byte codes otherwise) and `(...)` literal strings (supporting nested parentheses and PDF backslash escapes `\n`, `\r`, `\t`, `\b`, `\f`, `\(`, `\)`, `\\`, and 1–3 digit octal `\ddd`, plus line-continuation `\` followed by `\r\n`, `\r`, or `\n`).
4. **Coordinate transformation and text operators:**
   - Track the graphics state stack (`q`, `Q`) and Current Transformation Matrix (`cm`: `ctm = multiply(m_cm, ctm)`).
   - Inside `BT ... ET`, track the text matrix (`Tm`), text line matrix (`Td`, `TD`, `T*`), leading (`TL`, and `TD` which sets `TL = -ty`), font/size (`Tf`), and text-showing operators (`Tj`, `TJ`, `'`, `"`).
   - Transform the text baseline position through `M = multiply(tm, ctm)` to obtain page coordinates `x = round2(M[4])` and `y = round2(height - M[5])`, and effective font size `fontSize = round2(Math.abs(tfSize * M[3]) || Math.abs(tfSize * M[0]))`.
   - Within a single `BT ... ET` block, coalesce consecutive glyph-showing operations that remain on the same horizontal baseline (`|Δy| <= 0.5` pt in page space) into one `PdfTextItem` anchored at the first glyph's `(x, y)`. If `Tm`, `Td`, `TD`, `T*`, `'`, or `"` shifts `y` by more than `0.5` pt in page space within the same `BT ... ET` block, emit the current `PdfTextItem` (if non-empty) and start a new `PdfTextItem` at the new position.
   - Ignore empty or whitespace-only `PdfTextItem` spans.
   - Sort each page's `items` top-to-bottom by `y` (treating items with `|a.y - b.y| <= 1.5` as the same line) and left-to-right by `x`.
5. **Logical row grouping (`groupPageRows`):**
   - First group `items` into horizontal lines (`|item.y - line.y| <= 1.5` pt), sorting each line's items by ascending `x`.
   - Merge wrapped two-line table cells into a single `PdfTextItem` (joining the first and second line texts with `' '`), supporting both:
     - **Vertically centered LCR table rows** (as on page 18 of `organizations-and-callings.pdf`), where line `i` has a single item at `x0`, line `i + 2` (`6 <= y2 - y0 <= 12`) has a single item at the same `x0` (`|Δx| <= 1.5`), and line `i + 1` sits at the vertical midpoint (`|(y0 + y2) / 2 - y1| <= 1.5`) with items only in other columns (`|x - x0| > 5`); and
     - **Top-aligned wrapped table cells**, where a multi-column body row at `y0 > 30` is immediately followed by a single-item line at `y1` (`6 <= y1 - y0 <= 11`, `fontSize <= 8.5`, `!bold`, not a `Count:` or `*` footnote row) whose `x` matches one of the non-bold cells on the row (`|Δx| <= 1.5`).

## Scope

May change:
- `packages/importer/package.json` (new)
- `packages/importer/tsconfig.json` (new)
- `packages/importer/src/index.ts` (new)
- `packages/importer/src/pdf/**` (new)
- `packages/importer/test/**` (new)
- `docker/Dockerfile` (add `COPY packages/importer/package.json ./packages/importer/package.json` in the runtime stage)
- `pnpm-lock.yaml` (updated by `pnpm install` for the new `@wardboard/importer` workspace package)

Must not change:
- `fixtures/lcr-reports/**`
- `packages/core/**`, `apps/server/**`, `apps/web/**`, `scripts/**`, `docs/**`

New dependencies allowed: `"vitest": "5.0.5"` in `packages/importer/package.json` (`devDependencies` only; already in the workspace store). Zero runtime dependencies.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Importer PDF extraction unit tests | `pnpm --filter @wardboard/importer exec vitest run test/pdf-extract.test.ts` | exits 0; all tests in `test/pdf-extract.test.ts` pass |
| 2 | Package test, typecheck, and lint scripts | `pnpm --filter @wardboard/importer test && pnpm --filter @wardboard/importer typecheck && pnpm --filter @wardboard/importer lint` | exits 0 with 0 warnings |
| 3 | Fixture reports untouched | `git diff main --stat -- fixtures/lcr-reports` | empty output; exits 0 |
| 4 | Full quality gate | `./scripts/verify.sh` | exits 0 (`verify: all steps passed`) |

## Unit tests to write

| Test name (`packages/importer/test/pdf-extract.test.ts`) | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `extracts Out-of-Unit Callings metadata, section headers, and aligned rows across Skia and Helvetica streams` | `out-of-unit-callings.pdf` yields `title: 'Out-of-Unit Callings'`, `pageCount: 1`, `612x792`, and aligns `ToUnicode` (`F4`/`F5`) and `Helvetica` (`helv`) cells onto the same `y` row for all 3 sections (`Stake Callings` 11 rows + `Count: 11`, `Serving outside of assigned unit` 26 rows + `Count: 26`, `Living outside of Unit` 0 rows + `Count: 0`) | Failing to apply the nested `cm` graphics matrix or `ToUnicode` CMap so `F4` and `helv` coordinates or strings don't match |
| `extracts Members without Callings across 4 pages and reconciles all 145 member rows with Count: 145` | `members-without-callings.pdf` yields `title: 'Members without Callings'`, `pageCount: 4`, page-1 header `['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number']`, member rows continuing across page breaks on pages 2–4 without repeated table headers, and exactly 145 member rows matching `Count: 145` on page 4 | Dropping pages after page 1 or losing rows near the bottom/top page break (`y = 755.25` / `y = 33.75`) |
| `extracts all 25 pages of Organizations and Callings from nested Pages Kids nodes` | `organizations-and-callings.pdf` yields `title: 'Organizations and Callings'`, `pageCount: 25`, `pages` numbered `1..25`, `95` italic `'Calling Vacant'` items (`italic: true`, `fontName: 'LiberationSans-Italic'`), and `73` set-apart `'✓'` items (`fontName: 'IPAGothic'`) | Only reading direct children of the root `/Pages` object (yielding 0 or 4 pages instead of 25) or failing to strip subset prefixes / set `italic` |
| `distinguishes calling and member-roster tables in Organizations and Callings and reconciles all 81 section counts across page breaks` | Across the 25 pages of `organizations-and-callings.pdf`, bold table headers identify 58 calling table sections (`Calling / Name / Sustained / Set Apart`) and 23 member-roster sections (`Name / [Gender /] Age / Birth Date / Phone Number / Email`), and every section's row count between its header and `Count: N` footer (including tables split across page breaks) matches `N` with 0 mismatches | Failing to merge wrapped two-line names or miscomputing `y` coordinates across page breaks |
| `merges the two wrapped two-line member names on page 18 of Organizations and Callings into their single rows` | On page 18 of `organizations-and-callings.pdf`, `groupPageRows` produces `'Fairwell, Cameron Sage Bailey Dakota Skyler'` on the `y = 59.25` row with `'M'`, `'13'`, `'21 Dec 2012'`, `'cameron.fairwell62@example.com'`, and `'Fairwell, Sage Casey Kendall Reagan'` on the `y = 400.5` row with `'M'`, `'14'`, `'13 Apr 2012'`, `'555-0307'`, `'sage.fairwell63@example.com'` | Leaving wrapped name lines as separate unaligned rows at `y = 54.75`/`63.75` and `y = 396`/`405` |
| `produces identical deterministic output across repeated runs on all three fixture reports` | Calling `extractPdf` twice on each fixture PDF returns `deepEqual` `PdfDocument` objects | Mutating shared state or non-deterministic sort order |
| `handles synthetic PDFs with multi-line BT blocks (Td/TD/T*), top-aligned wrapped cells, Contents stream arrays, and CMap array bfranges` | Synthetic uncompressed PDF exercises multi-line text inside a single `BT ... ET` (`Td`, `TD`, `T*`, `'`), top-aligned two-line cell wrapping, `/Contents [N 0 R M 0 R]`, inherited `/MediaBox`/`/Resources`, octal/escaped literals, and `beginbfrange <start> <end> [<u1> <u2>]` | Assuming every `BT ... ET` is single-line or `/Contents` is always a single object reference |
| `rejects empty, non-PDF, catalog-less, and corrupt FlateDecode inputs with PdfParseError` | Empty `Uint8Array`, arbitrary text bytes, a `%PDF-1.4` stub without `/Catalog` or `/Pages`, an unsupported stream filter, and a truncated `/FlateDecode` stream each throw `PdfParseError` with the expected `code` | Returning an empty `pages: []` result or throwing an untyped error on invalid input |

## Edge cases (each needs a test)

- Empty `Uint8Array` input (`code: 'EMPTY_PDF'`).
- Non-PDF binary/text input and PDF missing `/Catalog` or `/Pages` (`code: 'INVALID_PDF'`).
- Corrupt `/FlateDecode` stream or unsupported stream filter (`code: 'INVALID_PDF'` / `'UNSUPPORTED_PDF'`).
- Nested `/Pages` `/Kids` tree with inherited `/MediaBox` and `/Resources`.
- `/Contents` specified as an array of multiple stream references `[N 0 R M 0 R]`.
- Multi-line `BT ... ET` block using `Td`, `TD`, `T*`, or `'` with non-zero vertical offset.
- Both vertically centered wrapped table cells (LCR HTML print layout) and top-aligned wrapped table cells.
- PDF literal string escapes (`\(`, `\)`, `\\`, `\n`, `\r`, `\t`, octal `\ddd`) and CMap `beginbfrange` array form `<start> <end> [<u1> <u2>]`.

## Human checks

none

## Out of scope

- Report-specific domain parsers for Callings by Organization (`T-053`), Members without Callings (`T-054`), and Out-of-Unit Callings (`T-055`).
- Allow-list filtering and canary leakage checks (`T-056`) and identity reconciliation (`T-057`).
- OCR or image extraction from PDFs (SPEC §11 and §14 confirm LCR reports are selectable text PDFs and OCR is out of scope).
