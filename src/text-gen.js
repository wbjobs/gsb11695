/**
 * Deterministic pseudo-random text generator for the benchmark.
 * Pure module (no DOM) so it can be unit-tested in Node.
 */

const WORDS = [
  'glyph', 'cache', 'render', 'canvas', 'bitmap', 'sdf', 'font', 'atlas',
  'worker', 'shader', 'texture', 'vector', 'pixel', 'frame', 'layout',
  'metrics', 'advance', 'baseline', 'kerning', 'raster', 'quad', 'alpha',
  'blend', 'scale', 'rotate', 'transform', 'viewport', 'culling', 'memory',
  'budget', 'evict', 'lru', 'measure', 'observer', 'indexeddb', 'fontface',
];
const PUNCT = ['.', ',', ';', ':', '!', '?', '-', '(', ')', '/', '+', '='];
const DIGITS = '0123456789';

/** mulberry32 PRNG — deterministic for reproducible benchmarks. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate ~`count` characters of mixed text (words, digits, punctuation,
 * newlines) so the unique-character set stays small (~80 chars) like real UIs.
 */
export function generateText(count, seed = 11695) {
  const rng = makeRng(seed);
  const parts = [];
  let len = 0;
  while (len < count) {
    const r = rng();
    let piece;
    if (r < 0.72) {
      piece = WORDS[(rng() * WORDS.length) | 0];
    } else if (r < 0.82) {
      piece = String((rng() * 100000) | 0);
    } else if (r < 0.9) {
      piece = PUNCT[(rng() * PUNCT.length) | 0];
    } else if (r < 0.94) {
      piece = DIGITS[(rng() * 10) | 0];
    } else {
      piece = WORDS[(rng() * WORDS.length) | 0].toUpperCase();
    }
    // ~8% of tokens end a line explicitly
    piece += rng() < 0.08 ? '\n' : ' ';
    parts.push(piece);
    len += piece.length;
  }
  return parts.join('').slice(0, count);
}

/** Sorted unique characters of a string (atlas charset). */
export function uniqueChars(text) {
  return [...new Set(text)].sort();
}

/** djb2 hash — keys IndexedDB atlas entries by charset. */
export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
