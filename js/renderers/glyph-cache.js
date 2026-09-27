// 方案一：字形缓存渲染器。
// 按需把字形光栅化进动态图集，缓存键 = 字体| snapped 尺寸|字符；
// 内存超预算或手动失效时整体清空（代际递增），并统计命中/未命中/驱逐。

import { viewMatrix, visibleRowRange } from '../layout.js';

const ATLAS_SIZE = 2048;
const SNAP = 8; // 尺寸量化步长，控制缓存键数量

export class GlyphCacheRenderer {
  constructor() {
    this.name = 'glyph';
    this.usesWebGL = false;
    this.budgetBytes = 32 * 1024 * 1024;
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = ATLAS_SIZE;
    this.actx = this.atlas.getContext('2d', { willReadFrequently: false });
    this._resetAtlas();
    this.stats = { hits: 0, misses: 0, evictions: 0, entries: 0, bytes: 0, generation: 0 };
  }

  _resetAtlas() {
    this.cache = new Map();
    this.cursor = { x: 0, y: 0, rowH: 0 };
    this.actx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.stats.entries = 0;
    this.stats.bytes = 0;
  }

  invalidate(reason = 'manual') {
    this.stats.evictions += this.cache.size;
    this.stats.generation++;
    this._resetAtlas();
    console.info(`[glyph-cache] invalidated (${reason}), generation=${this.stats.generation}`);
  }

  setBudgetMB(mb) {
    this.budgetBytes = mb * 1024 * 1024;
    if (this.stats.bytes > this.budgetBytes) this.invalidate('budget');
  }

  setFont(family) { this.family = family; }

  _snap(size) { return Math.max(SNAP, Math.ceil(size / SNAP) * SNAP); }

  _rasterize(ch, size) {
    const ctx = this.actx;
    ctx.font = `${size}px ${this.family}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(ch);
    const ascent = Math.ceil(m.actualBoundingBoxAscent ?? size * 0.8);
    const descent = Math.ceil(m.actualBoundingBoxDescent ?? size * 0.25);
    const w = Math.max(1, Math.ceil(m.width));
    const h = ascent + descent;
    const cw = w + 2, chh = h + 2;
    if (this.cursor.x + cw > ATLAS_SIZE) {
      this.cursor.x = 0;
      this.cursor.y += this.cursor.rowH;
      this.cursor.rowH = 0;
    }
    if (this.cursor.y + chh > ATLAS_SIZE) return null; // 图集满 -> 触发整代驱逐
    const sx = this.cursor.x, sy = this.cursor.y;
    ctx.fillStyle = '#e8e8ec';
    ctx.fillText(ch, sx + 1, sy + 1 + ascent);
    this.cursor.x += cw;
    this.cursor.rowH = Math.max(this.cursor.rowH, chh);
    return { sx, sy, w, h, ascent, bytes: cw * chh * 4 };
  }

  _get(ch, snapped) {
    const key = `${this.family}|${snapped}|${ch}`;
    const hit = this.cache.get(key);
    if (hit) { this.stats.hits++; return hit; }
    this.stats.misses++;
    const entry = this._rasterize(ch, snapped);
    if (!entry || this.stats.bytes + entry.bytes > this.budgetBytes) {
      // 内存预算耗尽或图集满：整代驱逐后重试一次
      this.invalidate('pressure');
      const retry = this._rasterize(ch, snapped);
      if (!retry) return null;
      this.cache.set(`${this.family}|${snapped}|${ch}`, retry);
      this.stats.bytes += retry.bytes;
      this.stats.entries++;
      return retry;
    }
    this.cache.set(key, entry);
    this.stats.bytes += entry.bytes;
    this.stats.entries++;
    return entry;
  }

  render(ctx, view, layout) {
    const { fontSize, scale } = view;
    const snapped = this._snap(fontSize * scale);
    const k = fontSize / snapped; // 内容坐标系下的缩放系数
    const m = viewMatrix(view);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.fillStyle = '#e8e8ec';
    const range = visibleRowRange(view, layout);
    const { chars, rowStart, cell } = layout;
    let drawn = 0;
    for (let r = range.row0; r <= range.row1; r++) {
      for (let i = rowStart[r]; i < rowStart[r + 1]; i++) {
        const g = chars[i];
        if (g.x + cell < range.minX || g.x > range.maxX) continue;
        if (g.ch === ' ') continue;
        const e = this._get(g.ch, snapped);
        if (!e) continue;
        const dw = e.w * k, dh = e.h * k;
        const dx = g.x + (cell - dw) / 2;
        const dy = g.y + cell * 0.8 - e.ascent * k; // 基线对齐到单元 80% 处
        ctx.drawImage(this.atlas, e.sx, e.sy, e.w, e.h, dx, dy, dw, dh);
        drawn++;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.drawn = drawn;
    return drawn;
  }

  getStats() {
    return {
      命中: this.stats.hits, 未命中: this.stats.misses,
      驱逐: this.stats.evictions, 缓存代际: this.stats.generation,
      条目: this.stats.entries,
      内存: (this.stats.bytes / 1024 / 1024).toFixed(2) + ' MB',
      本帧字形: this.stats.drawn ?? 0,
    };
  }
}
