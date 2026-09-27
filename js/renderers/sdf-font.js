// 方案三：SDF 字体渲染器。
// 主线程光栅化掩码图集 -> Web Worker 计算 SDF -> WebGL 纹理 + smoothstep 着色。
// 任意缩放/旋转均保持边缘清晰；构建失败时抛错，由上层降级到位图字体。

import { viewMatrix, visibleRowRange } from '../layout.js';

const ATLAS_SIZE = 2048;
const CELL = 48;        // 每字形图集单元（含 padding）
const GLYPH = 40;       // 单元内光栅化字号
const SPREAD = 8;       // SDF 扩散半径（像素）

const VERT = `
attribute vec2 aPos; attribute vec2 aUV;
uniform mat3 uMatrix; varying vec2 vUV;
void main() {
  vec3 p = uMatrix * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex; uniform vec4 uColor; uniform float uWidth;
void main() {
  float d = texture2D(uTex, vUV).a;
  float a = smoothstep(0.5 - uWidth, 0.5 + uWidth, d);
  gl_FragColor = vec4(uColor.rgb, uColor.a * a);
}`;

export class SDFontRenderer {
  constructor(canvas) {
    this.name = 'sdf';
    this.usesWebGL = true;
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl;
    this._initProgram();
    this.metrics = new Map();
    this.buildMs = 0;
    this.generation = 0;
    this.onProgress = null;
    this._token = 0;
  }

  _initProgram() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUV = gl.getAttribLocation(prog, 'aUV');
    this.uMatrix = gl.getUniformLocation(prog, 'uMatrix');
    this.uColor = gl.getUniformLocation(prog, 'uColor');
    this.uWidth = gl.getUniformLocation(prog, 'uWidth');
    this.vbo = gl.createBuffer();
    this.vertCapacity = 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // 主线程光栅化掩码图集（兼容系统字体与 FontFace 自定义字体）
  _rasterizeMask(family, chars) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.font = `${GLYPH}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const perRow = Math.floor(ATLAS_SIZE / CELL);
    chars.forEach((ch, i) => {
      const cx = (i % perRow) * CELL, cy = Math.floor(i / perRow) * CELL;
      if (cy + CELL > ATLAS_SIZE) return;
      ctx.fillText(ch, cx + CELL / 2, cy + CELL / 2 + 1);
    });
    return ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  }

  _buildSdf(mask) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/workers/sdf-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('SDF 构建超时')); }, 30000);
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') { this.onProgress?.(msg.value); return; }
        clearTimeout(timer);
        worker.terminate();
        if (msg.type === 'done') resolve(msg.sdf);
        else reject(new Error(msg.message || 'SDF 构建失败'));
      };
      worker.onerror = (err) => { clearTimeout(timer); worker.terminate(); reject(err); };
      const perRow = Math.floor(ATLAS_SIZE / CELL);
      worker.postMessage({
        mask: mask.data.buffer,
        atlasSize: ATLAS_SIZE, cell: CELL, spread: SPREAD,
        cols: perRow, rows: perRow,
      }, [mask.data.buffer]);
    });
  }

  async setFont(family, uniqueChars) {
    const token = ++this._token;
    const t0 = performance.now();
    const mask = this._rasterizeMask(family, uniqueChars);
    const sdfBuffer = await this._buildSdf(mask);
    if (token !== this._token) return; // 已被更新的构建取代
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const image = new ImageData(new Uint8ClampedArray(sdfBuffer), ATLAS_SIZE, ATLAS_SIZE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.metrics.clear();
    const perRow = Math.floor(ATLAS_SIZE / CELL);
    uniqueChars.forEach((ch, i) => {
      const cx = (i % perRow) * CELL, cy = Math.floor(i / perRow) * CELL;
      if (cy + CELL > ATLAS_SIZE) return;
      this.metrics.set(ch, {
        u0: cx / ATLAS_SIZE, v0: cy / ATLAS_SIZE,
        u1: (cx + CELL) / ATLAS_SIZE, v1: (cy + CELL) / ATLAS_SIZE,
      });
    });
    this.glyphCount = this.metrics.size;
    this.generation++;
    this.buildMs = performance.now() - t0;
  }

  invalidate() {
    // 由 main 触发 setFont 重建；这里仅记录代际失效语义
    this.generation++;
  }

  render(view, layout) {
    if (!this.tex) return 0;
    const gl = this.gl;
    const { width, height, fontSize, scale } = view;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.078, 0.082, 0.094, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);

    // 内容坐标 -> 屏幕 -> 裁剪空间
    const m = viewMatrix(view);
    const w2 = 2 / width, h2 = 2 / height;
    gl.uniformMatrix3fv(this.uMatrix, false, [
      w2 * m.a, -h2 * m.b, 0,
      w2 * m.c, -h2 * m.d, 0,
      w2 * m.e - 1, -h2 * m.f + 1, 1,
    ]);
    gl.uniform4f(this.uColor, 0.91, 0.91, 0.93, 1);
    gl.uniform1f(this.uWidth, Math.min(0.35, Math.max(0.02, 3 / (fontSize * scale))));

    const range = visibleRowRange(view, layout);
    const { chars, rowStart, cell } = layout;
    const k = fontSize / CELL;
    const size = CELL * k; // 内容坐标系下的四边形尺寸
    const needed = (range.row1 - range.row0 + 1) * layout.cols * 6 * 4;
    if (!this.verts || this.verts.length < needed) {
      this.verts = new Float32Array(Math.max(needed, 4096));
    }
    let n = 0;
    const v = this.verts;
    for (let r = range.row0; r <= range.row1; r++) {
      for (let i = rowStart[r]; i < rowStart[r + 1]; i++) {
        const g = chars[i];
        if (g.x + cell < range.minX || g.x > range.maxX) continue;
        if (g.ch === ' ') continue;
        const mt = this.metrics.get(g.ch);
        if (!mt) continue;
        const x0 = g.x, y0 = g.y, x1 = g.x + size, y1 = g.y + size;
        // 两个三角形，6 顶点，pos(2)+uv(2) 交错
        v[n++] = x0; v[n++] = y0; v[n++] = mt.u0; v[n++] = mt.v0;
        v[n++] = x1; v[n++] = y0; v[n++] = mt.u1; v[n++] = mt.v0;
        v[n++] = x1; v[n++] = y1; v[n++] = mt.u1; v[n++] = mt.v1;
        v[n++] = x0; v[n++] = y0; v[n++] = mt.u0; v[n++] = mt.v0;
        v[n++] = x1; v[n++] = y1; v[n++] = mt.u1; v[n++] = mt.v1;
        v[n++] = x0; v[n++] = y1; v[n++] = mt.u0; v[n++] = mt.v1;
      }
    }
    const drawn = n / 24;
    if (!drawn) return 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 8);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawArrays(gl.TRIANGLES, 0, n / 4);
    this.drawn = drawn;
    return drawn;
  }

  getStats() {
    return {
      图集字形: this.glyphCount ?? 0,
      构建耗时: (this.buildMs ?? 0).toFixed(1) + ' ms（Worker）',
      图集代际: this.generation,
      特性: '任意缩放/旋转边缘清晰',
      本帧字形: this.drawn ?? 0,
    };
  }
}
