/**
 * Atlas generation Web Worker (module worker).
 * Builds bitmap-font atlases and SDF atlases off the main thread:
 * rasterizes each glyph with the loaded FontFace on an OffscreenCanvas,
 * then (for SDF) runs a distance transform per cell.
 */
import { computeSDF } from '../sdf-core.js';

const workerFonts = new Map(); // fontId -> family (already registered)

async function ensureFont(fontId, family, buffer) {
  if (workerFonts.has(fontId)) return workerFonts.get(fontId);
  const face = new FontFace(family, buffer);
  await face.load();
  self.fonts.add(face);
  workerFonts.set(fontId, family);
  return family;
}

function makeCtx(w, h) {
  const canvas = new OffscreenCanvas(w, h);
  return canvas.getContext('2d', { willReadFrequently: true });
}

function measureSet(ctx, chars) {
  const advs = new Float32Array(chars.length);
  for (let i = 0; i < chars.length; i++) {
    advs[i] = ctx.measureText(chars[i]).width;
  }
  const probe = ctx.measureText('Hg');
  const ascent = probe.actualBoundingBoxAscent || 0;
  const descent = probe.actualBoundingBoxDescent || 0;
  return { advs, ascent, descent };
}

function gridFor(count, cellSize) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows, atlasW: cols * cellSize, atlasH: rows * cellSize };
}

async function buildBitmapAtlas(msg) {
  const { fontId, family, buffer, chars, rasterSize, pad } = msg;
  await ensureFont(fontId, family, buffer);
  const cellSize = rasterSize + pad * 2;
  const { cols, rows, atlasW, atlasH } = gridFor(chars.length, cellSize);

  const atlas = makeCtx(atlasW, atlasH);
  atlas.fillStyle = '#fff';
  atlas.font = `${rasterSize}px ${family}`;
  atlas.textBaseline = 'alphabetic';

  const measureCanvas = makeCtx(1, 1);
  measureCanvas.font = `${rasterSize}px ${family}`;
  const { advs, ascent } = measureSet(measureCanvas, chars);

  for (let i = 0; i < chars.length; i++) {
    const sx = (i % cols) * cellSize;
    const sy = ((i / cols) | 0) * cellSize;
    atlas.fillText(chars[i], sx + pad, sy + pad + ascent);
    if (i % 32 === 0) postProgress('bitmap', i, chars.length);
  }
  const bitmap = atlas.canvas.transferToImageBitmap();
  return { bitmap, advs, info: { rasterSize, cellSize, pad, ascent, cols, rows, atlasW, atlasH } };
}

async function buildSdfAtlas(msg) {
  const { fontId, family, buffer, chars, rasterSize, pad, spread } = msg;
  await ensureFont(fontId, family, buffer);
  const cellSize = rasterSize + pad * 2;
  const { cols, rows, atlasW, atlasH } = gridFor(chars.length, cellSize);

  const measureCanvas = makeCtx(1, 1);
  measureCanvas.font = `${rasterSize}px ${family}`;
  const { advs, ascent } = measureSet(measureCanvas, chars);

  const cell = makeCtx(cellSize, cellSize);
  cell.font = `${rasterSize}px ${family}`;
  cell.fillStyle = '#fff';
  cell.textBaseline = 'alphabetic';

  const atlas = makeCtx(atlasW, atlasH);
  const atlasData = atlas.createImageData(atlasW, atlasH);

  for (let i = 0; i < chars.length; i++) {
    cell.clearRect(0, 0, cellSize, cellSize);
    cell.fillText(chars[i], pad, pad + ascent);
    const img = cell.getImageData(0, 0, cellSize, cellSize);
    const alpha = new Uint8Array(cellSize * cellSize);
    for (let p = 0; p < alpha.length; p++) alpha[p] = img.data[p * 4 + 3];
    const sdf = computeSDF(alpha, cellSize, cellSize, spread);

    const ox = (i % cols) * cellSize;
    const oy = ((i / cols) | 0) * cellSize;
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        const dst = ((oy + y) * atlasW + (ox + x)) * 4;
        const v = sdf[y * cellSize + x];
        atlasData.data[dst] = v;
        atlasData.data[dst + 1] = v;
        atlasData.data[dst + 2] = v;
        atlasData.data[dst + 3] = 255;
      }
    }
    if (i % 8 === 0) postProgress('sdf', i, chars.length);
  }
  atlas.putImageData(atlasData, 0, 0);
  const bitmap = atlas.canvas.transferToImageBitmap();
  return { bitmap, advs, info: { rasterSize, cellSize, pad, ascent, cols, rows, atlasW, atlasH, spread } };
}

function postProgress(kind, done, total) {
  self.postMessage({ type: 'progress', kind, done, total });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    let result;
    if (msg.type === 'bitmap-atlas') result = await buildBitmapAtlas(msg);
    else if (msg.type === 'sdf-atlas') result = await buildSdfAtlas(msg);
    else throw new Error(`unknown job: ${msg.type}`);
    self.postMessage(
      { type: 'done', job: msg.type, requestId: msg.requestId, ...result },
      [result.bitmap, result.advs.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', requestId: msg.requestId, message: String(err?.message || err) });
  }
};
