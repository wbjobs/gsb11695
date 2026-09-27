/**
 * SDF (signed distance field) generation from a binary alpha bitmap.
 * Pure typed-array math, shared between the atlas Web Worker and Node tests.
 *
 * Convention of the output: 255 = deep inside the glyph, 0 = far outside,
 * 128 ~= edge. `spread` is the distance in pixels mapped to half the range.
 */

const INF = 1e9;
const D1 = 1;
const D2 = Math.SQRT2;

/** Two-pass chamfer (3x3) distance transform. mask: Uint8Array (1 = zero-distance seed). */
function chamferDistance(mask, w, h) {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : INF;

  // forward pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + D1);
      if (y > 0) {
        d = Math.min(d, dist[i - w] + D1);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + D2);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + D2);
      }
      dist[i] = d;
    }
  }
  // backward pass
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + D1);
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + D1);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + D2);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + D2);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/**
 * @param alpha Uint8Array/Uint8ClampedArray of luminance/alpha, length w*h
 * @returns Uint8Array w*h SDF, 128 = edge
 */
export function computeSDF(alpha, w, h, spread = 8) {
  const n = w * h;
  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha[i] > 128) inside[i] = 1;
    else outside[i] = 1;
  }
  // distance from each inside pixel to the nearest outside pixel, and vice versa
  const distToOutside = chamferDistance(outside, w, h);
  const distToInside = chamferDistance(inside, w, h);

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const signed = inside[i] ? distToOutside[i] : -distToInside[i];
    let v = 0.5 + signed / (2 * spread);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    out[i] = Math.round(v * 255);
  }
  return out;
}
