/**
 * Main-thread client for the atlas worker, with IndexedDB persistence:
 * generated atlases are stored as PNG blobs keyed by
 * kind|font|charset-hash|params, so a page reload skips regeneration.
 */
import { dbGet, dbPut } from './db.js';
import { hashString } from './text-gen.js';

let worker = null;
let requestSeq = 0;
const pending = new Map();

function getWorker(onProgress) {
  if (!worker) {
    worker = new Worker('src/workers/atlas-worker.js', { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        pending.get('__progress')?.(msg);
        return;
      }
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      if (msg.type === 'error') entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    };
    worker.onerror = (err) => {
      for (const [, entry] of pending) entry.reject(new Error(err.message || 'worker error'));
      pending.clear();
      worker = null;
    };
  }
  if (onProgress) pending.set('__progress', onProgress);
  return worker;
}

function requestAtlas(job, onProgress) {
  const requestId = ++requestSeq;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    getWorker(onProgress).postMessage({ ...job, requestId });
  });
}

export function atlasKey(kind, fontId, chars, params) {
  return `${kind}|${fontId}|${hashString(chars.join(''))}|${params}`;
}

/**
 * @returns {Promise<{bitmap: ImageBitmap, advs: Float32Array, info: object, source: 'idb'|'worker'}>}
 */
export async function getAtlas({ kind, font, chars, params, job, onProgress, forceRegenerate = false }) {
  const key = atlasKey(kind, font.fontId, chars, params);
  if (!forceRegenerate) {
    const cached = await dbGet('atlases', key).catch(() => undefined);
    if (cached) {
      const bitmap = await createImageBitmap(cached.blob);
      return { bitmap, advs: new Float32Array(cached.advs), info: cached.info, source: 'idb' };
    }
  }
  const result = await requestAtlas(
    { type: job, fontId: font.fontId, family: font.family, buffer: font.buffer.slice(0), chars, ...paramsToJob(params) },
    onProgress,
  );
  const advs = new Float32Array(result.advs);
  // persist a PNG copy (fire-and-forget)
  persistAtlas(key, kind, font.fontId, result.bitmap, advs, result.info).catch(() => {});
  return { bitmap: result.bitmap, advs, info: result.info, source: 'worker' };
}

function paramsToJob(params) {
  // params string "rasterSize.pad[.spread]" -> explicit job fields
  const [rasterSize, pad, spread] = params.split('.').map(Number);
  return { rasterSize, pad, ...(spread ? { spread } : {}) };
}

async function persistAtlas(key, kind, fontId, bitmap, advs, info) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await dbPut('atlases', key, { kind, fontId, blob, advs: advs.buffer.slice(0), info });
}
