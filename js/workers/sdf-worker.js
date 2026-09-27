// SDF 生成 Worker：接收主线程光栅化的掩码图集，逐单元计算有符号距离场。
// 使用两遍 Chamfer 距离变换（权重 1 / √2），结果写入 alpha 通道，边缘为 0.5。

const SQRT2 = Math.SQRT2;

function chamfer(src, n) {
  const INF = 1e9;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - n] + 1);
        if (x > 0) v = Math.min(v, d[i - n - 1] + SQRT2);
        if (x < n - 1) v = Math.min(v, d[i - n + 1] + SQRT2);
      }
      d[i] = v;
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let v = d[i];
      if (x < n - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < n - 1) {
        v = Math.min(v, d[i + n] + 1);
        if (x < n - 1) v = Math.min(v, d[i + n + 1] + SQRT2);
        if (x > 0) v = Math.min(v, d[i + n - 1] + SQRT2);
      }
      d[i] = v;
    }
  }
  return d;
}

self.onmessage = (e) => {
  const { mask, atlasSize, cell, spread, cols, rows } = e.data;
  try {
    const src = new Uint8ClampedArray(mask);
    const out = new Uint8ClampedArray(atlasSize * atlasSize * 4);
    const inside = new Uint8Array(cell * cell);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const baseX = cx * cell, baseY = cy * cell;
        let hasInk = false;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const a = src[((baseY + y) * atlasSize + baseX + x) * 4 + 3];
            inside[y * cell + x] = a > 127 ? 1 : 0;
            if (a > 127) hasInk = true;
          }
        }
        if (!hasInk) continue;
        const dOut = chamfer(inside, cell);          // 外部像素到边缘距离
        const inverted = inside.map((v) => (v ? 0 : 1));
        const dIn = chamfer(inverted, cell);         // 内部像素到边缘距离
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const i = y * cell + x;
            let v = 0.5 + (dIn[i] - dOut[i]) / (2 * spread);
            v = v < 0 ? 0 : v > 1 ? 1 : v;
            const o = ((baseY + y) * atlasSize + baseX + x) * 4;
            out[o] = out[o + 1] = out[o + 2] = 255;
            out[o + 3] = (v * 255) | 0;
          }
        }
      }
      // 分行汇报进度，便于主线程展示
      if ((cy & 7) === 0) self.postMessage({ type: 'progress', value: cy / rows });
    }
    self.postMessage({ type: 'done', sdf: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
