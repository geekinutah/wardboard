/**
 * Parser for PDF ToUnicode CMap streams.
 */
export class CMap {
  private readonly chars = new Map<number, string>();
  private readonly ranges: Array<{
    start: number;
    end: number;
    target: number | string[];
  }> = [];

  addChar(code: number, unicode: string): void {
    this.chars.set(code, unicode);
  }

  addRange(start: number, end: number, target: number | string[]): void {
    this.ranges.push({ start, end, target });
  }

  lookup(code: number): string | undefined {
    const direct = this.chars.get(code);
    if (direct !== undefined) return direct;

    for (const r of this.ranges) {
      if (code >= r.start && code <= r.end) {
        const offset = code - r.start;
        if (typeof r.target === 'number') {
          return String.fromCharCode(r.target + offset);
        }
        if (Array.isArray(r.target)) {
          return r.target[offset];
        }
      }
    }
    return undefined;
  }
}

function parseHexUnicode(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length === 0) return '';
  let result = '';
  // Hex unicode values in ToUnicode CMaps are 2-byte or 4-byte big-endian codes
  for (let i = 0; i < clean.length; i += 4) {
    const slice = clean.slice(i, i + 4);
    if (slice.length === 4) {
      result += String.fromCharCode(parseInt(slice, 16));
    } else if (slice.length === 2) {
      result += String.fromCharCode(parseInt(slice, 16));
    }
  }
  return result;
}

export function parseCMap(cmapText: string): CMap {
  const cmap = new CMap();

  // Parse beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar\s*([\s\S]*?)\s*endbfchar/g;
  let match: RegExpExecArray | null;
  while ((match = bfcharRegex.exec(cmapText)) !== null) {
    const content = match[1] ?? '';
    const charLineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let charMatch: RegExpExecArray | null;
    while ((charMatch = charLineRegex.exec(content)) !== null) {
      const srcHex = charMatch[1] ?? '';
      const dstHex = charMatch[2] ?? '';
      const srcCode = parseInt(srcHex, 16);
      const dstStr = parseHexUnicode(dstHex);
      cmap.addChar(srcCode, dstStr);
    }
  }

  // Parse beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange\s*([\s\S]*?)\s*endbfrange/g;
  while ((match = bfrangeRegex.exec(cmapText)) !== null) {
    const content = match[1] ?? '';
    // Form 1: <start> <end> <targetStart>
    // Form 2: <start> <end> [ <t1> <t2> ... ]
    const tokenRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let rangeMatch: RegExpExecArray | null;
    while ((rangeMatch = tokenRegex.exec(content)) !== null) {
      const startHex = rangeMatch[1] ?? '';
      const endHex = rangeMatch[2] ?? '';
      const targetStartHex = rangeMatch[3];
      const targetArrayStr = rangeMatch[4];

      const start = parseInt(startHex, 16);
      const end = parseInt(endHex, 16);

      if (targetStartHex !== undefined) {
        // Form 1
        const targetStart = parseInt(targetStartHex, 16);
        cmap.addRange(start, end, targetStart);
      } else if (targetArrayStr !== undefined) {
        // Form 2
        const items: string[] = [];
        const itemRegex = /<([0-9a-fA-F]+)>/g;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = itemRegex.exec(targetArrayStr)) !== null) {
          items.push(parseHexUnicode(itemMatch[1] ?? ''));
        }
        cmap.addRange(start, end, items);
      }
    }
  }

  return cmap;
}
