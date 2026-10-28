import type { CMap } from './cmap.ts';
import type { PdfTextItem } from './types.ts';

export interface FontInfo {
  readonly fontName: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly cmap?: CMap | undefined;
  readonly is2Byte: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function multiply(
  A: readonly number[],
  B: readonly number[],
): [number, number, number, number, number, number] {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = A;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = B;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

const WIN_ANSI_MAP: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

function decodeString(raw: string, font: FontInfo | undefined): string {
  if (!font) return raw;

  if (raw.startsWith('<') && raw.endsWith('>')) {
    const hex = raw.slice(1, -1);
    let result = '';
    if (font.cmap || font.is2Byte) {
      // 2-byte big-endian codes
      for (let i = 0; i < hex.length; i += 4) {
        const chunk = hex.slice(i, i + 4);
        if (chunk.length === 4) {
          const code = parseInt(chunk, 16);
          const mapped = font.cmap?.lookup(code);
          result += mapped !== undefined ? mapped : String.fromCharCode(code);
        }
      }
    } else {
      // 1-byte hex codes
      for (let i = 0; i < hex.length; i += 2) {
        const chunk = hex.slice(i, i + 2);
        if (chunk.length === 2) {
          const code = parseInt(chunk, 16);
          if (WIN_ANSI_MAP[code] !== undefined) {
            result += String.fromCharCode(WIN_ANSI_MAP[code] ?? code);
          } else {
            result += String.fromCharCode(code);
          }
        }
      }
    }
    return result;
  }

  // Literal string (already unescaped by tokenizer)
  // Literal strings are 1-byte characters in PDF content streams
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const mapped = font.cmap?.lookup(code);
    if (mapped !== undefined) {
      result += mapped;
    } else if (WIN_ANSI_MAP[code] !== undefined) {
      result += String.fromCharCode(WIN_ANSI_MAP[code] ?? code);
    } else {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

interface MutableItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
}

type ContentOperand = number | string | Array<number | string>;

export function extractPageTextItems(
  content: string,
  pageHeight: number,
  fonts: Map<string, FontInfo>,
): PdfTextItem[] {
  const items: PdfTextItem[] = [];

  let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  const ctmStack: Array<[number, number, number, number, number, number]> = [];

  let tm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  let tlm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  let tl = 0; // leading
  let currentFontResName = '';
  let currentFontSize = 0;

  let pending: MutableItem | null = null;

  function flushPending(): void {
    if (pending && pending.text.trim().length > 0) {
      items.push({
        text: pending.text,
        x: pending.x,
        y: pending.y,
        fontSize: pending.fontSize,
        fontName: pending.fontName,
        bold: pending.bold,
        italic: pending.italic,
      });
    }
    pending = null;
  }

  function getFont(): FontInfo | undefined {
    return fonts.get(currentFontResName);
  }

  function getCurrentBaseline(): { x: number; y: number; fontSize: number } {
    const M = multiply(tm, ctm);
    const x = round2(M[4]);
    const y = round2(pageHeight - M[5]);
    const fontSize = round2(
      Math.abs(currentFontSize * M[3]) || Math.abs(currentFontSize * M[0]),
    );
    return { x, y, fontSize };
  }

  function showText(rawText: string): void {
    const font = getFont();
    const decoded = decodeString(rawText, font);
    if (!decoded || decoded.length === 0) return;

    const { x, y, fontSize } = getCurrentBaseline();
    const fontName = font?.fontName ?? 'Unknown';
    const bold = font?.bold ?? false;
    const italic = font?.italic ?? false;

    if (
      pending &&
      Math.abs(y - pending.y) <= 0.5 &&
      pending.fontName === fontName &&
      pending.fontSize === fontSize &&
      pending.bold === bold &&
      pending.italic === italic
    ) {
      pending.text += decoded;
    } else {
      flushPending();
      pending = {
        text: decoded,
        x,
        y,
        fontSize,
        fontName,
        bold,
        italic,
      };
    }
  }

  function checkYShift(): void {
    if (!pending) return;
    const { y } = getCurrentBaseline();
    if (Math.abs(y - pending.y) > 0.5) {
      flushPending();
    }
  }

  // Tokenize content stream
  let i = 0;
  const len = content.length;
  const operands: ContentOperand[] = [];

  while (i < len) {
    // Skip whitespace and comments
    const code = content.charCodeAt(i);
    if (code <= 32) {
      i++;
      continue;
    }
    if (code === 37) {
      // '%'
      while (i < len && content.charCodeAt(i) !== 10 && content.charCodeAt(i) !== 13) {
        i++;
      }
      continue;
    }

    // Literal string ( ... )
    if (code === 40) {
      // '('
      i++;
      let depth = 1;
      let str = '';
      while (i < len && depth > 0) {
        const c = content.charAt(i);
        if (c === '\\') {
          i++;
          if (i >= len) break;
          const next = content.charAt(i);
          if (next === 'n') str += '\n';
          else if (next === 'r') str += '\r';
          else if (next === 't') str += '\t';
          else if (next === 'b') str += '\b';
          else if (next === 'f') str += '\f';
          else if (next === '(') str += '(';
          else if (next === ')') str += ')';
          else if (next === '\\') str += '\\';
          else if (next === '\r') {
            if (content.charAt(i + 1) === '\n') i++;
          } else if (next === '\n') {
            // ignore
          } else if (/[0-7]/.test(next)) {
            let octal = next;
            if (i + 1 < len && /[0-7]/.test(content.charAt(i + 1))) {
              octal += content.charAt(++i);
              if (i + 1 < len && /[0-7]/.test(content.charAt(i + 1))) {
                octal += content.charAt(++i);
              }
            }
            str += String.fromCharCode(parseInt(octal, 8));
          } else {
            str += next;
          }
          i++;
        } else if (c === '(') {
          depth++;
          str += '(';
          i++;
        } else if (c === ')') {
          depth--;
          if (depth > 0) str += ')';
          i++;
        } else {
          str += c;
          i++;
        }
      }
      operands.push(str);
      continue;
    }

    // Hex string < ... >
    if (code === 60) {
      // '<'
      i++;
      let hex = '';
      while (i < len && content.charAt(i) !== '>') {
        const c = content.charAt(i);
        if (/[0-9a-fA-F]/.test(c)) hex += c;
        i++;
      }
      if (i < len && content.charAt(i) === '>') i++;
      if (hex.length % 2 !== 0) hex += '0';
      operands.push(`<${hex}>`);
      continue;
    }

    // Array [ ... ]
    if (code === 91) {
      // '['
      i++;
      const arr: Array<number | string> = [];
      let token = '';
      while (i < len) {
        const ch = content.charCodeAt(i);
        if (ch <= 32) {
          if (token.length > 0) {
            arr.push(parseFloat(token));
            token = '';
          }
          i++;
          continue;
        }
        if (ch === 93) {
          // ']'
          if (token.length > 0) {
            arr.push(parseFloat(token));
          }
          i++;
          break;
        }
        if (ch === 40) {
          // '(' string inside array
          if (token.length > 0) {
            arr.push(parseFloat(token));
            token = '';
          }
          i++;
          let depth = 1;
          let str = '';
          while (i < len && depth > 0) {
            const c = content.charAt(i);
            if (c === '\\') {
              i++;
              if (i >= len) break;
              const next = content.charAt(i);
              if (next === 'n') str += '\n';
              else if (next === 'r') str += '\r';
              else if (next === 't') str += '\t';
              else if (next === 'b') str += '\b';
              else if (next === 'f') str += '\f';
              else if (next === '(') str += '(';
              else if (next === ')') str += ')';
              else if (next === '\\') str += '\\';
              else if (/[0-7]/.test(next)) {
                let octal = next;
                if (i + 1 < len && /[0-7]/.test(content.charAt(i + 1))) {
                  octal += content.charAt(++i);
                  if (i + 1 < len && /[0-7]/.test(content.charAt(i + 1))) {
                    octal += content.charAt(++i);
                  }
                }
                str += String.fromCharCode(parseInt(octal, 8));
              } else {
                str += next;
              }
              i++;
            } else if (c === '(') {
              depth++;
              str += '(';
              i++;
            } else if (c === ')') {
              depth--;
              if (depth > 0) str += ')';
              i++;
            } else {
              str += c;
              i++;
            }
          }
          arr.push(str);
          continue;
        }
        if (ch === 60) {
          // '<' hex string inside array
          if (token.length > 0) {
            arr.push(parseFloat(token));
            token = '';
          }
          i++;
          let hex = '';
          while (i < len && content.charAt(i) !== '>') {
            const c = content.charAt(i);
            if (/[0-9a-fA-F]/.test(c)) hex += c;
            i++;
          }
          if (i < len && content.charAt(i) === '>') i++;
          if (hex.length % 2 !== 0) hex += '0';
          arr.push(`<${hex}>`);
          continue;
        }
        token += content.charAt(i);
        i++;
      }
      operands.push(arr);
      continue;
    }

    // Name /Name
    if (code === 47) {
      // '/'
      i++;
      let name = '';
      while (i < len) {
        const c = content.charCodeAt(i);
        if (
          c <= 32 ||
          c === 40 ||
          c === 41 ||
          c === 60 ||
          c === 62 ||
          c === 91 ||
          c === 93 ||
          c === 47 ||
          c === 37
        ) {
          break;
        }
        name += content.charAt(i);
        i++;
      }
      operands.push('/' + name);
      continue;
    }

    // Regular token: number or operator keyword
    let token = '';
    while (i < len) {
      const c = content.charCodeAt(i);
      if (
        c <= 32 ||
        c === 40 ||
        c === 41 ||
        c === 60 ||
        c === 62 ||
        c === 91 ||
        c === 93 ||
        c === 47 ||
        c === 37
      ) {
        break;
      }
      token += content.charAt(i);
      i++;
    }

    // Check if token is a number
    if (/^-?(?:\d*\.\d+|\d+\.?)$/.test(token)) {
      operands.push(parseFloat(token));
      continue;
    }

    // Otherwise token is an operator keyword!
    const op = token;

    if (op === 'q') {
      ctmStack.push([...ctm]);
      operands.length = 0;
    } else if (op === 'Q') {
      const popped = ctmStack.pop();
      if (popped) ctm = popped;
      operands.length = 0;
    } else if (op === 'cm') {
      if (operands.length >= 6) {
        const slice = operands.slice(-6);
        const a = typeof slice[0] === 'number' ? slice[0] : 1;
        const b = typeof slice[1] === 'number' ? slice[1] : 0;
        const c = typeof slice[2] === 'number' ? slice[2] : 0;
        const d = typeof slice[3] === 'number' ? slice[3] : 1;
        const e = typeof slice[4] === 'number' ? slice[4] : 0;
        const f = typeof slice[5] === 'number' ? slice[5] : 0;
        ctm = multiply([a, b, c, d, e, f], ctm);
      }
      operands.length = 0;
    } else if (op === 'BT') {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
      operands.length = 0;
    } else if (op === 'ET') {
      flushPending();
      operands.length = 0;
    } else if (op === 'Tf') {
      if (operands.length >= 2) {
        const size = operands[operands.length - 1];
        const rawFont = operands[operands.length - 2];
        const fontName = typeof rawFont === 'string' && rawFont.startsWith('/') ? rawFont.slice(1) : String(rawFont);
        currentFontResName = fontName;
        currentFontSize = typeof size === 'number' ? size : parseFloat(String(size));
      }
      operands.length = 0;
    } else if (op === 'Tm') {
      if (operands.length >= 6) {
        const slice = operands.slice(-6);
        const a = typeof slice[0] === 'number' ? slice[0] : 1;
        const b = typeof slice[1] === 'number' ? slice[1] : 0;
        const c = typeof slice[2] === 'number' ? slice[2] : 0;
        const d = typeof slice[3] === 'number' ? slice[3] : 1;
        const e = typeof slice[4] === 'number' ? slice[4] : 0;
        const f = typeof slice[5] === 'number' ? slice[5] : 0;
        tm = [a, b, c, d, e, f];
        tlm = [a, b, c, d, e, f];
        checkYShift();
      }
      operands.length = 0;
    } else if (op === 'Td') {
      if (operands.length >= 2) {
        const tyVal = operands[operands.length - 1];
        const txVal = operands[operands.length - 2];
        const ty = typeof tyVal === 'number' ? tyVal : parseFloat(String(tyVal));
        const tx = typeof txVal === 'number' ? txVal : parseFloat(String(txVal));
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
        checkYShift();
      }
      operands.length = 0;
    } else if (op === 'TD') {
      if (operands.length >= 2) {
        const tyVal = operands[operands.length - 1];
        const txVal = operands[operands.length - 2];
        const ty = typeof tyVal === 'number' ? tyVal : parseFloat(String(tyVal));
        const tx = typeof txVal === 'number' ? txVal : parseFloat(String(txVal));
        tl = -ty;
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
        checkYShift();
      }
      operands.length = 0;
    } else if (op === 'T*') {
      tlm = multiply([1, 0, 0, 1, 0, -tl], tlm);
      tm = [...tlm];
      checkYShift();
      operands.length = 0;
    } else if (op === 'TL') {
      if (operands.length >= 1) {
        const tlVal = operands[operands.length - 1];
        tl = typeof tlVal === 'number' ? tlVal : parseFloat(String(tlVal));
      }
      operands.length = 0;
    } else if (op === 'Tj') {
      if (operands.length >= 1) {
        const textArg = operands[operands.length - 1];
        showText(String(textArg));
      }
      operands.length = 0;
    } else if (op === 'TJ') {
      if (operands.length >= 1) {
        const arr = operands[operands.length - 1];
        if (Array.isArray(arr)) {
          let combined = '';
          for (const elem of arr) {
            if (typeof elem === 'string') {
              combined += decodeString(elem, getFont());
            }
          }
          if (combined.length > 0) {
            const { x, y, fontSize } = getCurrentBaseline();
            const font = getFont();
            const fontName = font?.fontName ?? 'Unknown';
            const bold = font?.bold ?? false;
            const italic = font?.italic ?? false;

            if (
              pending &&
              Math.abs(y - pending.y) <= 0.5 &&
              pending.fontName === fontName &&
              pending.fontSize === fontSize &&
              pending.bold === bold &&
              pending.italic === italic
            ) {
              pending.text += combined;
            } else {
              flushPending();
              pending = {
                text: combined,
                x,
                y,
                fontSize,
                fontName,
                bold,
                italic,
              };
            }
          }
        }
      }
      operands.length = 0;
    } else if (op === "'") {
      // T* then Tj
      tlm = multiply([1, 0, 0, 1, 0, -tl], tlm);
      tm = [...tlm];
      checkYShift();
      if (operands.length >= 1) {
        showText(String(operands[operands.length - 1]));
      }
      operands.length = 0;
    } else if (op === '"') {
      // set word spacing, char spacing, then '
      tlm = multiply([1, 0, 0, 1, 0, -tl], tlm);
      tm = [...tlm];
      checkYShift();
      if (operands.length >= 1) {
        showText(String(operands[operands.length - 1]));
      }
      operands.length = 0;
    } else {
      // Any other operator clears operands
      operands.length = 0;
    }
  }

  flushPending();
  return items;
}
