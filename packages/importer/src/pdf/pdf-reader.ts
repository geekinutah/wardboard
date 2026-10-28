import { inflateSync } from 'node:zlib';
import { PdfParseError } from './types.ts';

export class PdfRef {
  readonly num: number;
  readonly gen: number;

  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}

export class PdfName {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export class PdfDict {
  private readonly map = new Map<string, PdfValue>();

  get(key: string): PdfValue | undefined {
    return this.map.get(key);
  }

  set(key: string, val: PdfValue): void {
    this.map.set(key, val);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  entries(): IterableIterator<[string, PdfValue]> {
    return this.map.entries();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }
}

export class PdfStream {
  readonly dict: PdfDict;
  readonly data: Uint8Array;

  constructor(dict: PdfDict, data: Uint8Array) {
    this.dict = dict;
    this.data = data;
  }
}

export type PdfValue =
  | null
  | boolean
  | number
  | string
  | PdfRef
  | PdfName
  | PdfValue[]
  | PdfDict
  | PdfStream;

export class PdfReader {
  private readonly buffer: Uint8Array;
  private readonly text: string;
  private readonly objectOffsets = new Map<number, number>();
  private readonly resolvedObjects = new Map<number, PdfValue>();
  readonly trailer: PdfDict;

  constructor(buffer: Uint8Array) {
    if (buffer.byteLength === 0) {
      throw new PdfParseError('EMPTY_PDF', 'Input PDF is empty');
    }
    this.buffer = buffer;
    // Latin1 preserves every byte 1:1 as character code 0..255
    let str = '';
    const chunkSize = 65536;
    for (let i = 0; i < buffer.length; i += chunkSize) {
      str += Buffer.from(buffer.subarray(i, Math.min(buffer.length, i + chunkSize))).toString('latin1');
    }
    this.text = str;

    if (!this.text.includes('%PDF-')) {
      throw new PdfParseError('INVALID_PDF', 'File does not contain %PDF- header');
    }

    this.scanObjectOffsets();
    this.trailer = this.parseTrailer();
  }

  private scanObjectOffsets(): void {
    // Scan all "N G obj" in the document
    const objRegex = /(\d+)\s+(\d+)\s+obj/g;
    let match: RegExpExecArray | null;
    while ((match = objRegex.exec(this.text)) !== null) {
      const num = parseInt(match[1] ?? '0', 10);
      if (!this.objectOffsets.has(num)) {
        this.objectOffsets.set(num, match.index);
      }
    }
  }

  private parseTrailer(): PdfDict {
    // Look for trailer from end of file
    const trailerIdx = this.text.lastIndexOf('trailer');
    if (trailerIdx !== -1) {
      const dictStart = this.text.indexOf('<<', trailerIdx);
      if (dictStart !== -1) {
        const val = this.parseValueAt(dictStart);
        if (val instanceof PdfDict) {
          return val;
        }
      }
    }

    // Fallback: look for catalog directly among objects
    for (const num of this.objectOffsets.keys()) {
      const obj = this.getObject(num);
      if (obj instanceof PdfDict && this.nameEquals(obj.get('Type'), 'Catalog')) {
        const dict = new PdfDict();
        dict.set('Root', new PdfRef(num, 0));
        return dict;
      }
    }

    throw new PdfParseError('INVALID_PDF', 'Missing PDF trailer and Catalog');
  }

  resolve(value: PdfValue | undefined): PdfValue | undefined {
    if (value instanceof PdfRef) {
      return this.getObject(value.num);
    }
    return value;
  }

  getObject(num: number): PdfValue | undefined {
    const cached = this.resolvedObjects.get(num);
    if (cached !== undefined) return cached;

    const offset = this.objectOffsets.get(num);
    if (offset === undefined) return undefined;

    // Skip "N G obj"
    const objHeaderRegex = /(\d+)\s+(\d+)\s+obj\s*/y;
    objHeaderRegex.lastIndex = offset;
    const match = objHeaderRegex.exec(this.text);
    if (!match) return undefined;

    const valStart = objHeaderRegex.lastIndex;
    const val = this.parseValueAt(valStart);

    // Check if followed by "stream"
    if (val instanceof PdfDict) {
      const streamIdx = this.skipWhitespaceAndComments(this.lastParsedIndex);
      if (this.text.startsWith('stream', streamIdx)) {
        let streamDataStart = streamIdx + 6;
        if (this.text.charCodeAt(streamDataStart) === 0x0d && this.text.charCodeAt(streamDataStart + 1) === 0x0a) {
          streamDataStart += 2;
        } else if (
          this.text.charCodeAt(streamDataStart) === 0x0a ||
          this.text.charCodeAt(streamDataStart) === 0x0d
        ) {
          streamDataStart += 1;
        }

        // Determine stream length
        let length: number | undefined;
        const lengthVal = this.resolve(val.get('Length'));
        if (typeof lengthVal === 'number') {
          length = lengthVal;
        }

        let streamDataEnd = -1;
        if (length !== undefined && length >= 0) {
          streamDataEnd = streamDataStart + length;
        } else {
          const foundEnd = this.text.indexOf('endstream', streamDataStart);
          if (foundEnd !== -1) {
            let end = foundEnd;
            if (end > streamDataStart && this.text.charCodeAt(end - 1) === 0x0a) end--;
            if (end > streamDataStart && this.text.charCodeAt(end - 1) === 0x0d) end--;
            streamDataEnd = end;
          }
        }

        if (streamDataEnd === -1) {
          throw new PdfParseError('INVALID_PDF', `Corrupted stream in object ${String(num)}`);
        }

        const rawData = this.buffer.subarray(streamDataStart, streamDataEnd);
        const decompressed = this.decompressStream(val, rawData);
        const streamObj = new PdfStream(val, decompressed);
        this.resolvedObjects.set(num, streamObj);
        return streamObj;
      }
    }

    this.resolvedObjects.set(num, val);
    return val;
  }

  private decompressStream(dict: PdfDict, raw: Uint8Array): Uint8Array {
    const filter = this.resolve(dict.get('Filter'));
    if (!filter) {
      return raw;
    }

    const filterName =
      filter instanceof PdfName
        ? filter.name
        : Array.isArray(filter) && filter[0] instanceof PdfName
          ? filter[0].name
          : typeof filter === 'string'
            ? filter
            : '';

    if (filterName === 'FlateDecode') {
      try {
        return new Uint8Array(inflateSync(Buffer.from(raw)));
      } catch (err) {
        throw new PdfParseError('INVALID_PDF', `Failed to decompress FlateDecode stream: ${String(err)}`);
      }
    }

    throw new PdfParseError('UNSUPPORTED_PDF', `Unsupported compression filter: ${filterName}`);
  }

  private lastParsedIndex = 0;

  private skipWhitespaceAndComments(index: number): number {
    let i = index;
    const len = this.text.length;
    while (i < len) {
      const code = this.text.charCodeAt(i);
      // NUL, TAB, LF, FF, CR, SPACE
      if (code === 0 || code === 9 || code === 10 || code === 12 || code === 13 || code === 32) {
        i++;
        continue;
      }
      if (code === 37) {
        // '%' comment: skip to next EOL
        i++;
        while (i < len && this.text.charCodeAt(i) !== 10 && this.text.charCodeAt(i) !== 13) {
          i++;
        }
        continue;
      }
      break;
    }
    return i;
  }

  parseValueAt(startIndex: number): PdfValue {
    let i = this.skipWhitespaceAndComments(startIndex);
    if (i >= this.text.length) {
      this.lastParsedIndex = i;
      return null;
    }

    const ch = this.text.charAt(i);

    // Dictionary << ... >>
    if (ch === '<' && this.text.charAt(i + 1) === '<') {
      const dict = new PdfDict();
      i += 2;
      while (i < this.text.length) {
        i = this.skipWhitespaceAndComments(i);
        if (i < this.text.length && this.text.charAt(i) === '>' && this.text.charAt(i + 1) === '>') {
          i += 2;
          break;
        }
        if (i >= this.text.length) break;
        // Parse key (must be a name)
        const keyVal = this.parseValueAt(i);
        i = this.lastParsedIndex;
        if (!(keyVal instanceof PdfName)) {
          break;
        }
        // Parse val
        const val = this.parseValueAt(i);
        i = this.lastParsedIndex;
        dict.set(keyVal.name, val);
      }
      this.lastParsedIndex = i;
      return dict;
    }

    // Hex string < ... >
    if (ch === '<') {
      i++;
      let hex = '';
      while (i < this.text.length && this.text.charAt(i) !== '>') {
        const c = this.text.charAt(i);
        if (/[0-9a-fA-F]/.test(c)) {
          hex += c;
        }
        i++;
      }
      if (i < this.text.length && this.text.charAt(i) === '>') i++;
      if (hex.length % 2 !== 0) hex += '0';
      this.lastParsedIndex = i;
      return `<${hex}>`;
    }

    // Literal string ( ... )
    if (ch === '(') {
      i++;
      let depth = 1;
      let str = '';
      while (i < this.text.length && depth > 0) {
        const c = this.text.charAt(i);
        if (c === '\\') {
          i++;
          if (i >= this.text.length) break;
          const next = this.text.charAt(i);
          if (next === 'n') str += '\n';
          else if (next === 'r') str += '\r';
          else if (next === 't') str += '\t';
          else if (next === 'b') str += '\b';
          else if (next === 'f') str += '\f';
          else if (next === '(') str += '(';
          else if (next === ')') str += ')';
          else if (next === '\\') str += '\\';
          else if (next === '\r') {
            if (this.text.charAt(i + 1) === '\n') i++;
          } else if (next === '\n') {
            // line continuation - do nothing
          } else if (/[0-7]/.test(next)) {
            // Octal escape \ddd (1-3 digits)
            let octal = next;
            if (i + 1 < this.text.length && /[0-7]/.test(this.text.charAt(i + 1))) {
              octal += this.text.charAt(++i);
              if (i + 1 < this.text.length && /[0-7]/.test(this.text.charAt(i + 1))) {
                octal += this.text.charAt(++i);
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
      this.lastParsedIndex = i;
      return str;
    }

    // Array [ ... ]
    if (ch === '[') {
      const arr: PdfValue[] = [];
      i++;
      while (i < this.text.length) {
        i = this.skipWhitespaceAndComments(i);
        if (i < this.text.length && this.text.charAt(i) === ']') {
          i++;
          break;
        }
        if (i >= this.text.length) break;
        const val = this.parseValueAt(i);
        i = this.lastParsedIndex;
        arr.push(val);
      }
      this.lastParsedIndex = i;
      return arr;
    }

    // Name /Name
    if (ch === '/') {
      i++;
      let name = '';
      while (i < this.text.length) {
        const code = this.text.charCodeAt(i);
        // Delimiters or whitespace end a name
        if (
          code <= 32 ||
          code === 0x28 || // (
          code === 0x29 || // )
          code === 0x3c || // <
          code === 0x3e || // >
          code === 0x5b || // [
          code === 0x5d || // ]
          code === 0x7b || // {
          code === 0x7d || // }
          code === 0x2f || // /
          code === 0x25 // %
        ) {
          break;
        }
        if (code === 0x23) {
          // #xx escape
          const hex = this.text.slice(i + 1, i + 3);
          name += String.fromCharCode(parseInt(hex, 16));
          i += 3;
        } else {
          name += this.text.charAt(i);
          i++;
        }
      }
      this.lastParsedIndex = i;
      return new PdfName(name);
    }

    // Number or Reference or Keyword
    let token = '';
    while (i < this.text.length) {
      const code = this.text.charCodeAt(i);
      if (
        code <= 32 ||
        code === 0x28 ||
        code === 0x29 ||
        code === 0x3c ||
        code === 0x3e ||
        code === 0x5b ||
        code === 0x5d ||
        code === 0x7b ||
        code === 0x7d ||
        code === 0x2f ||
        code === 0x25
      ) {
        break;
      }
      token += this.text.charAt(i);
      i++;
    }

    // Keywords
    if (token === 'true') {
      this.lastParsedIndex = i;
      return true;
    }
    if (token === 'false') {
      this.lastParsedIndex = i;
      return false;
    }
    if (token === 'null') {
      this.lastParsedIndex = i;
      return null;
    }

    // Check if token is integer and might be an indirect reference "N G R"
    if (/^-?\d+$/.test(token)) {
      const num = parseInt(token, 10);
      // Peek next tokens
      const nextIdx = this.skipWhitespaceAndComments(i);
      const nextTokenMatch = /^(\d+)\s+R\b/.exec(this.text.slice(nextIdx, nextIdx + 20));
      if (nextTokenMatch) {
        const gen = parseInt(nextTokenMatch[1] ?? '0', 10);
        this.lastParsedIndex = nextIdx + nextTokenMatch[0].length;
        return new PdfRef(num, gen);
      }
      this.lastParsedIndex = i;
      return num;
    }

    // Float number
    if (/^-?(?:\d*\.\d+|\d+\.?)$/.test(token)) {
      this.lastParsedIndex = i;
      return parseFloat(token);
    }

    this.lastParsedIndex = i;
    return token;
  }

  nameEquals(val: PdfValue | undefined, name: string): boolean {
    const resolved = this.resolve(val);
    if (resolved instanceof PdfName) return resolved.name === name;
    if (typeof resolved === 'string') return resolved === name;
    return false;
  }
}
