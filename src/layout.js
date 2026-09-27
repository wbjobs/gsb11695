/**
 * Character-level greedy-wrap layout in "text space" (unit = CSS px at base font size).
 * Pure module: the advance-measuring callback is injected by each renderer,
 * so glyph-cache / bitmap / SDF can lay out with their own metrics.
 */

export const BASE_FONT_SIZE = 16;
export const LINE_HEIGHT = BASE_FONT_SIZE * 1.3;
export const WRAP_WIDTH = 1600;

/**
 * @param text full string
 * @param measureAdvance (char) => advance in text-space px
 * @returns layout consumed by renderers and by viewport culling
 */
export function computeLayout(text, measureAdvance, {
  wrapWidth = WRAP_WIDTH,
  lineHeight = LINE_HEIGHT,
} = {}) {
  const n = text.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);   // baseline y
  const advs = new Float32Array(n);
  const lines = [];                 // {start, end, y} — end exclusive

  let x = 0;
  let line = 0;
  let lineStart = 0;

  const flushLine = (end) => {
    lines.push({ start: lineStart, end, y: (line + 1) * lineHeight });
    line++;
    lineStart = end;
    x = 0;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === '\n') {
      advs[i] = 0;
      xs[i] = x;
      ys[i] = (line + 1) * lineHeight;
      flushLine(i + 1);
      continue;
    }
    const adv = measureAdvance(ch);
    if (x > 0 && x + adv > wrapWidth) {
      flushLine(i);
    }
    xs[i] = x;
    ys[i] = (line + 1) * lineHeight;
    advs[i] = adv;
    x += adv;
  }
  if (lineStart < n) flushLine(n);

  return {
    count: n,
    xs, ys, advs, lines,
    lineHeight,
    width: wrapWidth,
    height: lines.length * lineHeight,
  };
}

/**
 * Conservative viewport culling: map the 4 screen corners back to text space,
 * take the AABB, then yield only chars whose row/column intersects it.
 *
 * @param layout from computeLayout
 * @param invTransform (px, py) => [tx, ty], screen CSS px -> text space
 * @param viewW/viewH viewport size in CSS px
 * @param visit (index) => void
 */
export function forEachVisibleChar(layout, invTransform, viewW, viewH, visit) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[0, 0], [viewW, 0], [0, viewH], [viewW, viewH]]) {
    const [tx, ty] = invTransform(px, py);
    if (tx < minX) minX = tx;
    if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty;
    if (ty > maxY) maxY = ty;
  }
  const pad = layout.lineHeight; // glyph ink can overflow its advance box
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const { lines, xs, advs } = layout;
  for (let li = 0; li < lines.length; li++) {
    const { start, end, y } = lines[li];
    if (y > maxY || y + layout.lineHeight < minY) continue;
    // xs ascend within a line -> binary search the first candidate
    let lo = start, hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] + advs[mid] < minX) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < end; i++) {
      if (xs[i] > maxX) break;
      visit(i);
    }
  }
}
