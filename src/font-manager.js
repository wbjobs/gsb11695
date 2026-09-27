/**
 * Webfont loading via the FontFace API, with the font binaries persisted in
 * IndexedDB so repeat visits (and worker atlas builds) skip the network.
 */
import { dbGet, dbPut } from './db.js';

export const FONTS = [
  { id: 'dejavu-sans', family: 'BenchDejaVuSans', url: 'fonts/DejaVuSans.ttf', label: 'DejaVu Sans' },
  { id: 'dejavu-mono', family: 'BenchDejaVuMono', url: 'fonts/DejaVuSansMono.ttf', label: 'DejaVu Sans Mono' },
  { id: 'dejavu-serif', family: 'BenchDejaVuSerif', url: 'fonts/DejaVuSerif-Bold.ttf', label: 'DejaVu Serif Bold' },
];

const loaded = new Map(); // fontId -> { family, buffer, source }

/**
 * @returns {Promise<{fontId, family, buffer, source:'idb'|'fetch'}>}
 */
export async function loadFont(fontId) {
  if (loaded.has(fontId)) return loaded.get(fontId);
  const def = FONTS.find((f) => f.id === fontId);
  if (!def) throw new Error(`unknown font: ${fontId}`);

  let buffer = await dbGet('fonts', fontId).catch(() => undefined);
  let source = 'idb';
  if (!buffer) {
    const resp = await fetch(def.url);
    if (!resp.ok) throw new Error(`fetch ${def.url}: ${resp.status}`);
    buffer = await resp.arrayBuffer();
    source = 'fetch';
    dbPut('fonts', fontId, buffer).catch(() => {});
  }

  const face = new FontFace(def.family, buffer);
  await face.load();
  document.fonts.add(face);
  await document.fonts.ready;

  const record = { fontId, family: def.family, buffer, source };
  loaded.set(fontId, record);
  return record;
}
