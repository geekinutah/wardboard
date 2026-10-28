export type PdfErrorCode = 'EMPTY_PDF' | 'INVALID_PDF' | 'UNSUPPORTED_PDF';

export class PdfParseError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = 'PdfParseError';
    this.code = code;
  }
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
