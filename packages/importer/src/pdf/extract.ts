import { parseCMap, type CMap } from './cmap.ts';
import { extractPageTextItems, type FontInfo } from './content-stream.ts';
import { groupPageRows } from './group-rows.ts';
import { PdfDict, PdfName, PdfReader, PdfStream, type PdfValue } from './pdf-reader.ts';
import {
  PdfParseError,
  type PdfDocument,
  type PdfPage,
  type PdfRow,
} from './types.ts';

export { groupPageRows } from './group-rows.ts';

interface PageNode {
  dict: PdfDict;
  mediaBox?: [number, number, number, number] | undefined;
  resources?: PdfDict | undefined;
}

function resolveDict(reader: PdfReader, val: PdfValue | undefined): PdfDict | undefined {
  const resolved = reader.resolve(val);
  if (resolved instanceof PdfDict) return resolved;
  if (resolved instanceof PdfStream) return resolved.dict;
  return undefined;
}

function parseMediaBox(val: PdfValue | undefined): [number, number, number, number] | undefined {
  if (!Array.isArray(val) || val.length < 4) return undefined;
  const nums = val.map((v) => (typeof v === 'number' ? v : 0));
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0];
}

export function extractPdf(input: Uint8Array): PdfDocument {
  const reader = new PdfReader(input);

  const rootVal = reader.resolve(reader.trailer.get('Root'));
  if (!(rootVal instanceof PdfDict)) {
    throw new PdfParseError('INVALID_PDF', 'PDF missing or invalid /Root catalog');
  }

  const pagesRootVal = reader.resolve(rootVal.get('Pages'));
  if (!(pagesRootVal instanceof PdfDict)) {
    throw new PdfParseError('INVALID_PDF', 'Catalog missing or invalid /Pages object');
  }

  // Traverse page tree recursively
  const pageNodes: PageNode[] = [];

  function traversePages(
    nodeDict: PdfDict,
    inheritedMediaBox?: [number, number, number, number],
    inheritedResources?: PdfDict,
  ): void {
    const mediaBox = parseMediaBox(reader.resolve(nodeDict.get('MediaBox'))) ?? inheritedMediaBox;
    const resources = resolveDict(reader, nodeDict.get('Resources')) ?? inheritedResources;

    const typeVal = reader.resolve(nodeDict.get('Type'));
    const isPages = reader.nameEquals(typeVal, 'Pages');
    const isPage = reader.nameEquals(typeVal, 'Page');

    if (isPages) {
      const kids = reader.resolve(nodeDict.get('Kids'));
      if (Array.isArray(kids)) {
        for (const kid of kids) {
          const kidDict = resolveDict(reader, kid);
          if (kidDict) {
            traversePages(kidDict, mediaBox, resources);
          }
        }
      }
    } else if (isPage) {
      pageNodes.push({
        dict: nodeDict,
        mediaBox,
        resources,
      });
    }
  }

  traversePages(pagesRootVal);

  if (pageNodes.length === 0) {
    throw new PdfParseError('INVALID_PDF', 'PDF contains no /Type /Page leaf nodes');
  }

  // Parse each page
  const pages: PdfPage[] = [];

  for (let pageIdx = 0; pageIdx < pageNodes.length; pageIdx++) {
    const pageNode = pageNodes[pageIdx];
    if (!pageNode) continue;

    const mediaBox = pageNode.mediaBox ?? [0, 0, 612, 792];
    const width = Math.abs(mediaBox[2] - mediaBox[0]);
    const height = Math.abs(mediaBox[3] - mediaBox[1]);

    // Extract content stream(s)
    let content = '';
    const contentsVal = reader.resolve(pageNode.dict.get('Contents'));
    if (contentsVal instanceof PdfStream) {
      content = Buffer.from(contentsVal.data).toString('latin1');
    } else if (Array.isArray(contentsVal)) {
      const parts: string[] = [];
      for (const item of contentsVal) {
        const stream = reader.resolve(item);
        if (stream instanceof PdfStream) {
          parts.push(Buffer.from(stream.data).toString('latin1'));
        }
      }
      content = parts.join('\n');
    }

    // Extract fonts from resources
    const fonts = new Map<string, FontInfo>();
    if (pageNode.resources) {
      const fontDictVal = resolveDict(reader, pageNode.resources.get('Font'));
      if (fontDictVal) {
        for (const [resName, fontRef] of fontDictVal.entries()) {
          const fontObj = resolveDict(reader, fontRef);
          if (fontObj) {
            // Get base font
            let baseFontVal = reader.resolve(fontObj.get('BaseFont'));
            if (!baseFontVal) {
              const descendants = reader.resolve(fontObj.get('DescendantFonts'));
              if (Array.isArray(descendants) && descendants[0]) {
                const descendantDict = resolveDict(reader, descendants[0]);
                if (descendantDict) {
                  baseFontVal = reader.resolve(descendantDict.get('BaseFont'));
                }
              }
            }

            let rawFontName = 'Unknown';
            if (baseFontVal instanceof PdfName) {
              rawFontName = baseFontVal.name;
            } else if (typeof baseFontVal === 'string') {
              rawFontName = baseFontVal;
            }

            // Strip 6-letter subset prefix
            const fontName = rawFontName.replace(/^[A-Z]{6}\+/, '');
            const bold = /bold/i.test(fontName);
            const italic = /italic|oblique/i.test(fontName);

            // ToUnicode
            let cmap: CMap | undefined;
            const toUnicodeVal = reader.resolve(fontObj.get('ToUnicode'));
            if (toUnicodeVal instanceof PdfStream) {
              const cmapText = Buffer.from(toUnicodeVal.data).toString('latin1');
              cmap = parseCMap(cmapText);
            }

            // Encoding
            const encodingVal = reader.resolve(fontObj.get('Encoding'));
            let encodingName = '';
            if (encodingVal instanceof PdfName) encodingName = encodingVal.name;
            else if (typeof encodingVal === 'string') encodingName = encodingVal;

            const is2Byte = encodingName === 'Identity-H' || Boolean(cmap);

            fonts.set(resName, {
              fontName,
              bold,
              italic,
              cmap,
              is2Byte,
            });
          }
        }
      }
    }

    // Extract positioned items
    const rawItems = extractPageTextItems(content, height, fonts);

    // Sort items top-to-bottom by y (1.5 pt tolerance), then left-to-right by x
    const sortedItems = [...rawItems].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 1.5) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    const rows: PdfRow[] = groupPageRows(sortedItems);

    pages.push({
      pageNumber: pageIdx + 1,
      width,
      height,
      items: sortedItems,
      rows,
    });
  }

  // Extract title
  let title: string | null = null;
  const infoVal = resolveDict(reader, reader.trailer.get('Info'));
  if (infoVal) {
    const titleVal = reader.resolve(infoVal.get('Title'));
    if (typeof titleVal === 'string' && titleVal !== 'null' && titleVal.trim().length > 0) {
      title = titleVal.trim();
    }
  }

  // Fallback title: if info title is missing or null, check page 1 top header
  if (!title && pages.length > 0) {
    const page1 = pages[0];
    if (page1) {
      const candidate = page1.items.find(
        (it) =>
          it.y <= 35 &&
          (it.text === 'Members without Callings' ||
            it.text === 'Organizations and Callings' ||
            it.text === 'Out-of-Unit Callings'),
      );
      if (candidate) {
        title = candidate.text;
      }
    }
  }

  return {
    title,
    pageCount: pages.length,
    pages,
  };
}
