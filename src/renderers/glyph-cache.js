/**
 * Scheme 1 — glyph cache.
 * Each (char, size-bucket) pair is rasterized once into a small canvas and
 * reused via drawImage. Entries live in an LRU cache with a byte budget:
 * when the budget is exceeded the least-recently-used glyphs are evicted
 * (memory control). Font switches and the "invalidate" action flush it.
 */
import { LRUCache } from '../lru.js';
import { BASE_FONT_SIZE } from '../layout.js';
import { forEachVisibleChar } from '../layout.js';
import { applyViewTransform, makeInverseTransform } from '../view2d.js';

const MIN_BUCKET = 8;
const MAX_BUCKET = 256;

export class GlyphCacheRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scratch = document.createElement('canvas').getContext('2d');
    this.cache = new LRUCache(32 * 1024 * 1024);
    this.family = null;
    this.text = '';
    this.layout = null;
    this.advanceMap = new Map(); // char -> advance at BASE_FONT_SIZE
    this.probeCache = new Map(); // bucket -> {ascent, descent, pad}
  }

  async prepare({ font }) {
    if (this.family !== font.family) {
      this.family = font.family;
      this.advanceMap.clear();
      this.probeCache.clear();
      this.invalidate(); // font change => cached glyphs are stale
    }
    this.scratch.font = `${BASE_FONT_SIZE}px ${this.family}`;
  }

  measureAdvance(ch) {
    let adv = this.advanceMap.get(ch);
    if (adv === undefined) {
      // scratch font may have been switched to a bucket size during rendering
      this.scratch.font = `${BASE_FONT_SIZE}px ${this.family}`;
      adv = ch === ' ' ? this.scratch.measureText(' ').width : this.scratch.measureText(ch).width;
      this.advanceMap.set(ch, adv);
    }
    return adv;
  }

  setLayout(layout, text) {
    this.layout = layout;
    this.text = text;
  }

  setBudget(bytes) {
    this.cache.setBudget(bytes);
  }

  invalidate() {
    this.cache.invalidate();
  }

  #probe(bucket) {
    let p = this.probeCache.get(bucket);
    if (!p) {
      this.scratch.font = `${bucket}px ${this.family}`;
      const m = this.scratch.measureText('Hg');
      p = {
        ascent: m.actualBoundingBoxAscent || bucket * 0.8,
        descent: m.actualBoundingBoxDescent || bucket * 0.2,
        pad: Math.ceil(bucket * 0.2),
      };
      this.probeCache.set(bucket, p);
    }
    return p;
  }

  #entryFor(ch, bucket) {
    const key = `${bucket}:${ch}`;
    let entry = this.cache.get(key);
    if (entry) return entry;

    const { ascent, descent, pad } = this.#probe(bucket);
    this.scratch.font = `${bucket}px ${this.family}`;
    const adv = this.scratch.measureText(ch).width;
    const w = Math.max(1, Math.ceil(adv + pad * 2));
    const h = Math.max(1, Math.ceil(ascent + descent + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.font = `${bucket}px ${this.family}`;
    ctx.fillStyle = '#e8ecff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, pad, pad + ascent);
    entry = { canvas, w, h, pad, ascent };
    this.cache.put(key, entry, w * h * 4);
    return entry;
  }

  render(view) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.layout) return;

    const effPx = BASE_FONT_SIZE * view.scale * view.dpr;
    const bucket = Math.min(MAX_BUCKET, Math.max(MIN_BUCKET, Math.round(effPx / 2) * 2));
    const k = BASE_FONT_SIZE / bucket;

    applyViewTransform(ctx, view);
    const inv = makeInverseTransform(view);
    const { xs, ys } = this.layout;
    const text = this.text;
    forEachVisibleChar(this.layout, inv, view.cssW, view.cssH, (i) => {
      const ch = text[i];
      if (ch === '\n') return;
      const e = this.#entryFor(ch, bucket);
      ctx.drawImage(
        e.canvas,
        xs[i] - e.pad * k,
        ys[i] - (e.pad + e.ascent) * k,
        e.w * k,
        e.h * k,
      );
    });
  }

  getStats() {
    return {
      ...this.cache.stats,
      entries: this.cache.size,
      bytes: this.cache.bytes,
      budget: this.cache.budgetBytes,
    };
  }
}
