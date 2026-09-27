/**
 * Scheme 2 — bitmap font.
 * One fixed-resolution atlas (rasterized in a Web Worker, persisted in
 * IndexedDB). Rendering is a single drawImage per glyph from the atlas.
 * Because the atlas resolution is fixed, upscaling visibly blurs — the
 * classic bitmap-font limitation this demo quantifies.
 */
import { BASE_FONT_SIZE, forEachVisibleChar } from '../layout.js';
import { applyViewTransform, makeInverseTransform } from '../view2d.js';
import { getAtlas } from '../atlas-client.js';

const RASTER_SIZE = 48;
const PAD = 4;

export class BitmapFontRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.atlas = null; // {bitmap, advs, info, source}
    this.charIndex = new Map(); // char -> atlas index
    this.layout = null;
    this.text = '';
    this.regenerations = 0;
  }

  async prepare({ font, chars, forceRegenerate = false, onProgress }) {
    const atlas = await getAtlas({
      kind: 'bitmap',
      font,
      chars,
      params: `${RASTER_SIZE}.${PAD}`,
      job: 'bitmap-atlas',
      forceRegenerate,
      onProgress,
    });
    this.atlas = atlas;
    this.charIndex = new Map(chars.map((c, i) => [c, i]));
    if (atlas.source === 'worker') this.regenerations++;
  }

  measureAdvance(ch) {
    if (!this.atlas) return BASE_FONT_SIZE * 0.5;
    const idx = this.charIndex.get(ch);
    if (idx === undefined) return BASE_FONT_SIZE * 0.5;
    return (this.atlas.advs[idx] / this.atlas.info.rasterSize) * BASE_FONT_SIZE;
  }

  setLayout(layout, text) {
    this.layout = layout;
    this.text = text;
  }

  invalidate() {
    // atlas itself is resolution-independent of view state; regeneration is
    // triggered by prepare({forceRegenerate:true}) from the UI action.
  }

  render(view) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.layout || !this.atlas) return;

    const { bitmap, info } = this.atlas;
    const k = BASE_FONT_SIZE / info.rasterSize;
    const cell = info.cellSize;

    applyViewTransform(ctx, view);
    const inv = makeInverseTransform(view);
    const { xs, ys } = this.layout;
    const text = this.text;
    forEachVisibleChar(this.layout, inv, view.cssW, view.cssH, (i) => {
      const ch = text[i];
      if (ch === '\n') return;
      const idx = this.charIndex.get(ch);
      if (idx === undefined) return;
      const sx = (idx % info.cols) * cell;
      const sy = ((idx / info.cols) | 0) * cell;
      ctx.drawImage(
        bitmap,
        sx, sy, cell, cell,
        xs[i] - info.pad * k,
        ys[i] - (info.pad + info.ascent) * k,
        cell * k,
        cell * k,
      );
    });
  }

  getStats() {
    const info = this.atlas?.info;
    return {
      atlasBytes: info ? info.atlasW * info.atlasH * 4 : 0,
      atlasSize: info ? `${info.atlasW}×${info.atlasH}` : '-',
      regenerations: this.regenerations,
      source: this.atlas?.source ?? '-',
    };
  }
}
