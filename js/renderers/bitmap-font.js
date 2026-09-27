// 方案二：位图字体渲染器。
// 按固定基准尺寸（32px）一次性生成图集，渲染时 drawImage 缩放。
// 优点：构建一次后渲染极快；缺点：放大明显模糊（用于对照“缩放模糊”问题）。

import { viewMatrix, visibleRowRange } from '../layout.js';

const BASE = 32;
const CELL = 36;
const ATLAS_SIZE = 2048;

export class BitmapFontRenderer {
  constructor() {
    this.name = 'bitmap';
    this.usesWebGL = false;
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = ATLAS_SIZE;
    this.actx = this.atlas.getContext('2d');
    this.metrics = new Map();
    this.buildMs = 0;
    this.generation = 0;
  }

  setFont(family, uniqueChars) {
    this.family = family;
    this._build(uniqueChars);
  }

  invalidate() { /* 位图字体无运行时缓存，重建图集即失效 */
    if (this._chars) this._build(this._chars);
  }

  _build(uniqueChars) {
    const t0 = performance.now();
    this._chars = uniqueChars;
    const ctx = this.actx;
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    ctx.font = `${BASE}px ${this.family}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8e8ec';
    this.metrics.clear();
    const perRow = Math.floor(ATLAS_SIZE / CELL);
    uniqueChars.forEach((ch, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      if ((row + 1) * CELL > ATLAS_SIZE) return; // 超出图集容量
      const m = ctx.measureText(ch);
      const ascent = Math.ceil(m.actualBoundingBoxAscent ?? BASE * 0.8);
      const descent = Math.ceil(m.actualBoundingBoxDescent ?? BASE * 0.25);
      const w = Math.max(1, Math.ceil(m.width));
      const sx = col * CELL, sy = row * CELL;
      ctx.fillText(ch, sx + 1, sy + 1 + ascent);
      this.metrics.set(ch, { sx, sy, w, h: ascent + descent, ascent });
    });
    this.generation++;
    this.buildMs = performance.now() - t0;
  }

  render(ctx, view, layout) {
    const k = view.fontSize / BASE;
    const m = viewMatrix(view);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const range = visibleRowRange(view, layout);
    const { chars, rowStart, cell } = layout;
    let drawn = 0;
    for (let r = range.row0; r <= range.row1; r++) {
      for (let i = rowStart[r]; i < rowStart[r + 1]; i++) {
        const g = chars[i];
        if (g.x + cell < range.minX || g.x > range.maxX) continue;
        if (g.ch === ' ') continue;
        const e = this.metrics.get(g.ch);
        if (!e) continue;
        const dw = e.w * k, dh = e.h * k;
        const dx = g.x + (cell - dw) / 2;
        const dy = g.y + cell * 0.8 - e.ascent * k;
        ctx.drawImage(this.atlas, e.sx, e.sy, e.w, e.h, dx, dy, dw, dh);
        drawn++;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawn = drawn;
    return drawn;
  }

  getStats() {
    return {
      图集字形: this.metrics.size,
      构建耗时: this.buildMs.toFixed(1) + ' ms',
      图集代际: this.generation,
      基准尺寸: BASE + ' px（放大即模糊）',
      本帧字形: this.drawn ?? 0,
    };
  }
}
