/** Node smoke tests for the pure (DOM-free) modules. Run: node test/run-tests.mjs */
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lru.js';
import { computeSDF } from '../src/sdf-core.js';
import { generateText, uniqueChars, hashString } from '../src/text-gen.js';
import { computeLayout, forEachVisibleChar, BASE_FONT_SIZE, LINE_HEIGHT } from '../src/layout.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test('lru: hit/miss/recency', () => {
  const c = new LRUCache(1000);
  c.put('a', 1, 100);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.stats.hits, 1);
  assert.equal(c.stats.misses, 1);
});

test('lru: evicts oldest when over budget', () => {
  const c = new LRUCache(250);
  c.put('a', 1, 100);
  c.put('b', 2, 100);
  c.get('a'); // refresh a -> b becomes oldest
  c.put('c', 3, 100); // 300 > 250 -> evict b
  assert.equal(c.peek('b'), undefined);
  assert.equal(c.peek('a'), 1);
  assert.equal(c.peek('c'), 3);
  assert.equal(c.bytes, 200);
  assert.equal(c.stats.evictions, 1);
});

test('lru: setBudget shrinks and invalidate clears', () => {
  const c = new LRUCache(1000);
  c.put('a', 1, 400);
  c.put('b', 2, 400);
  c.setBudget(500);
  assert.equal(c.size, 1);
  assert.equal(c.bytes, 400);
  c.invalidate();
  assert.equal(c.size, 0);
  assert.equal(c.bytes, 0);
  assert.equal(c.stats.invalidations, 1);
});

test('sdf: solid square has high interior, low exterior, edge ~128', () => {
  const w = 32, h = 32;
  const alpha = new Uint8Array(w * h);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) alpha[y * w + x] = 255;
  const sdf = computeSDF(alpha, w, h, 8);
  const center = sdf[16 * w + 16];
  const corner = sdf[0];
  const edge = sdf[8 * w + 8];
  assert.ok(center > 200, `center ${center} should be deep-inside`);
  assert.ok(corner < 40, `corner ${corner} should be far-outside`);
  assert.ok(edge > 100 && edge < 160, `edge ${edge} should be near 128`);
  for (const v of sdf) assert.ok(v >= 0 && v <= 255);
});

test('text-gen: deterministic, correct length, small charset', () => {
  const a = generateText(100000, 42);
  const b = generateText(100000, 42);
  assert.equal(a, b);
  assert.equal(a.length, 100000);
  assert.ok(uniqueChars(a).length < 120);
  assert.notEqual(generateText(100000, 43), a);
});

test('text-gen: hashString stable and distinct', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('layout: wraps greedily and respects explicit newlines', () => {
  const adv = () => 100; // every char 100px wide, wrap at 1600 -> 16 per line
  const layout = computeLayout('a'.repeat(40), adv, { wrapWidth: 1600, lineHeight: 20 });
  assert.equal(layout.lines.length, 3); // 16 + 16 + 8
  assert.equal(layout.xs[16], 0);
  assert.equal(layout.ys[16], 40);
  const withNl = computeLayout('ab\ncd', adv, { wrapWidth: 1600, lineHeight: 20 });
  assert.equal(withNl.lines.length, 2);
  assert.equal(withNl.ys[3], 40);
});

test('layout: culling visits only chars in the viewport', () => {
  const adv = () => 10;
  const text = 'x'.repeat(160 * 100); // 160 per line, 100 lines
  const layout = computeLayout(text, adv, { wrapWidth: 1600, lineHeight: 20 });
  const seen = [];
  // viewport maps 1:1 to text space, top-left 200x40 region
  forEachVisibleChar(layout, (px, py) => [px, py], 200, 40, (i) => seen.push(i));
  assert.ok(seen.length > 0);
  // lineHeight padding expands the box by one row on each side
  const rows = new Set(seen.map((i) => Math.floor(i / 160)));
  assert.ok(Math.max(...rows) <= 3, `rows ${[...rows]} should stay near the top`);
  assert.ok(!seen.some((i) => (i % 160) > 40), 'no far-right chars');
});

console.log(`\n${passed} tests passed`);
