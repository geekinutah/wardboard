import type { PdfRow, PdfTextItem } from './types.ts';

interface MutableLine {
  y: number;
  items: PdfTextItem[];
}

export function groupPageRows(items: readonly PdfTextItem[]): PdfRow[] {
  if (items.length === 0) return [];

  // Sort items top-to-bottom by y, then left-to-right by x
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1.5) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  // Group items into horizontal lines (|item.y - line.y| <= 1.5 pt)
  const lines: MutableLine[] = [];
  for (const item of sorted) {
    const lastLine = lines[lines.length - 1];
    if (lastLine && Math.abs(item.y - lastLine.y) <= 1.5) {
      lastLine.items.push(item);
    } else {
      lines.push({
        y: item.y,
        items: [item],
      });
    }
  }

  // Sort each line's items by ascending x
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  const rows: PdfRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const currentLine = lines[i];
    if (!currentLine) break;

    // Pattern 1: Vertically centered LCR table rows (e.g. page 18 of organizations-and-callings.pdf)
    // line i has a single item at x0
    // line i + 2 (6 <= y2 - y0 <= 12) has a single item at the same x0 (|Δx| <= 1.5)
    // line i + 1 sits at vertical midpoint (|(y0 + y2) / 2 - y1| <= 1.5) with items only in other columns (|x - x0| > 5)
    if (i + 2 < lines.length) {
      const line0 = currentLine;
      const line1 = lines[i + 1];
      const line2 = lines[i + 2];

      if (
        line0.items.length === 1 &&
        line2 &&
        line2.items.length === 1 &&
        line1 &&
        line1.items.length > 0
      ) {
        const item0 = line0.items[0];
        const item2 = line2.items[0];
        if (item0 && item2) {
          const x0 = item0.x;
          const deltaX = Math.abs(item2.x - x0);
          const y0 = line0.y;
          const y1 = line1.y;
          const y2 = line2.y;
          const deltaY = y2 - y0;
          const midY = (y0 + y2) / 2;
          const midDelta = Math.abs(midY - y1);

          const otherColumnsOnly = line1.items.every(
            (it) => Math.abs(it.x - x0) > 5,
          );

          if (
            deltaX <= 1.5 &&
            deltaY >= 6 &&
            deltaY <= 12 &&
            midDelta <= 1.5 &&
            otherColumnsOnly
          ) {
            // Merge item0 and item2 into a single item at line1's y
            const mergedItem: PdfTextItem = {
              text: `${item0.text} ${item2.text}`,
              x: item0.x,
              y: y1,
              fontSize: item0.fontSize,
              fontName: item0.fontName,
              bold: item0.bold,
              italic: item0.italic,
            };

            const mergedItems = [...line1.items, mergedItem].sort((a, b) => a.x - b.x);
            rows.push({
              y: y1,
              items: mergedItems,
            });
            i += 3;
            continue;
          }
        }
      }
    }

    // Pattern 2: Top-aligned wrapped table cells
    // multi-column body row at y0 > 30
    // immediately followed by a single-item line at y1 (6 <= y1 - y0 <= 11, fontSize <= 8.5, !bold, not a Count: or * footnote row)
    // whose x matches one of the non-bold cells on the row (|Δx| <= 1.5)
    if (i + 1 < lines.length && currentLine.items.length >= 2 && currentLine.y > 30) {
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.items.length === 1) {
        const singleItem = nextLine.items[0];
        if (singleItem) {
          const y0 = currentLine.y;
          const y1 = nextLine.y;
          const deltaY = y1 - y0;

          const isFootnote =
            singleItem.text.startsWith('Count:') ||
            singleItem.text.startsWith('*');

          if (
            deltaY >= 6 &&
            deltaY <= 11 &&
            singleItem.fontSize <= 8.5 &&
            !singleItem.bold &&
            !isFootnote
          ) {
            // Find non-bold matching cell on current row
            const targetIndex = currentLine.items.findIndex(
              (it) => !it.bold && Math.abs(it.x - singleItem.x) <= 1.5,
            );

            if (targetIndex !== -1) {
              const targetItem = currentLine.items[targetIndex];
              if (targetItem) {
                const mergedItem: PdfTextItem = {
                  text: `${targetItem.text} ${singleItem.text}`,
                  x: targetItem.x,
                  y: targetItem.y,
                  fontSize: targetItem.fontSize,
                  fontName: targetItem.fontName,
                  bold: targetItem.bold,
                  italic: targetItem.italic,
                };

                const updatedItems = [...currentLine.items];
                updatedItems[targetIndex] = mergedItem;

                rows.push({
                  y: currentLine.y,
                  items: updatedItems,
                });
                i += 2;
                continue;
              }
            }
          }
        }
      }
    }

    // Default: emit row as-is
    rows.push({
      y: currentLine.y,
      items: currentLine.items,
    });
    i += 1;
  }

  return rows;
}
