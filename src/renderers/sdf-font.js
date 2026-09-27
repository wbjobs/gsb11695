/**
 * Scheme 3 — SDF font.
 * The atlas worker rasterizes each glyph once and converts it to a signed
 * distance field; a WebGL2 shader reconstructs crisp edges with
 * fwidth-based smoothing, so text stays sharp at any scale/rotation.
 *
 * If WebGL2 (or the worker) is unavailable, prepare() throws
 * SdfUnavailableError and the app degrades to the bitmap-font scheme.
 */
import { BASE_FONT_SIZE } from '../layout.js';
import { getAtlas } from '../atlas-client.js';

const RASTER_SIZE = 48;
const PAD = 8;
const SPREAD = 8;

export class SdfUnavailableError extends Error {}

const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform mat3 u_mvp;
out vec2 v_uv;
void main() {
  vec3 p = u_mvp * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_color;
out vec4 outColor;
void main() {
  float d = texture(u_tex, v_uv).r;
  float w = max(fwidth(d), 1e-4);
  float a = smoothstep(0.5 - w, 0.5 + w, d);
  outColor = vec4(u_color, a);
}`;

function mul3(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    }
  }
  return o;
}

export class SdfFontRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new SdfUnavailableError('WebGL2 不可用');
    this.gl = gl;
    this.atlas = null;
    this.charIndex = new Map();
    this.layout = null;
    this.text = '';
    this.vertexCount = 0;
    this.bufferBytes = 0;
    this.regenerations = 0;
    this.initProgram();
  }

  initProgram() {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new SdfUnavailableError('shader 编译失败: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new SdfUnavailableError('program 链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    this.uMvp = gl.getUniformLocation(prog, 'u_mvp');
    this.uColor = gl.getUniformLocation(prog, 'u_color');
    this.uTex = gl.getUniformLocation(prog, 'u_tex');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer();
    this.uvBuf = gl.createBuffer();
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aUv = gl.getAttribLocation(prog, 'a_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  async prepare({ font, chars, forceRegenerate = false, onProgress }) {
    let atlas;
    try {
      atlas = await getAtlas({
        kind: 'sdf',
        font,
        chars,
        params: `${RASTER_SIZE}.${PAD}.${SPREAD}`,
        job: 'sdf-atlas',
        forceRegenerate,
        onProgress,
      });
    } catch (err) {
      throw new SdfUnavailableError(`SDF 图集生成失败: ${err.message}`);
    }
    this.atlas = atlas;
    this.charIndex = new Map(chars.map((c, i) => [c, i]));
    if (atlas.source === 'worker') this.regenerations++;

    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  measureAdvance(ch) {
    if (!this.atlas) return BASE_FONT_SIZE * 0.5;
    const idx = this.charIndex.get(ch);
    if (idx === undefined) return BASE_FONT_SIZE * 0.5;
    return (this.atlas.advs[idx] / this.atlas.info.rasterSize) * BASE_FONT_SIZE;
  }

  setLayout(layout, text) {
    this.layout = layout;
    this.text = text;
    this.buildBuffers();
  }

  invalidate() {}

  buildBuffers() {
    if (!this.layout || !this.atlas) return;
    const { xs, ys, count } = this.layout;
    const info = this.atlas.info;
    const k = BASE_FONT_SIZE / info.rasterSize;
    const cell = info.cellSize;
    const pos = new Float32Array(count * 6 * 2);
    const uv = new Float32Array(count * 6 * 2);
    let v = 0;
    for (let i = 0; i < count; i++) {
      const ch = this.text[i];
      if (ch === '\n') continue;
      const idx = this.charIndex.get(ch);
      if (idx === undefined) continue;
      const x0 = xs[i] - info.pad * k;
      const y0 = ys[i] - (info.pad + info.ascent) * k;
      const x1 = x0 + cell * k;
      const y1 = y0 + cell * k;
      const u0 = ((idx % info.cols) * cell) / info.atlasW;
      const v0 = (((idx / info.cols) | 0) * cell) / info.atlasH;
      const u1 = u0 + cell / info.atlasW;
      const v1 = v0 + cell / info.atlasH;
      pos.set([x0, y0, x1, y0, x0, y1, x1, y0, x1, y1, x0, y1], v * 2);
      uv.set([u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1], v * 2);
      v += 6;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, v * 2), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv.subarray(0, v * 2), gl.STATIC_DRAW);
    this.vertexCount = v;
    this.bufferBytes = v * 2 * 4 * 2;
  }

  mvp(view) {
    const c = Math.cos(view.rotation);
    const s = Math.sin(view.rotation);
    const proj = [2 / view.cssW, 0, -1, 0, -2 / view.cssH, 1, 0, 0, 1];
    const t2 = [1, 0, view.cx, 0, 1, view.cy, 0, 0, 1];
    const rot = [c, -s, 0, s, c, 0, 0, 0, 1];
    const scl = [view.scale, 0, 0, 0, view.scale, 0, 0, 0, 1];
    const t1 = [1, 0, -view.ax, 0, 1, -view.ay, 0, 0, 1];
    const m = mul3(proj, mul3(t2, mul3(rot, mul3(scl, t1))));
    return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  }

  render(view) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.07, 0.08, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.layout || !this.atlas || this.vertexCount === 0) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTex, 0);
    gl.uniformMatrix3fv(this.uMvp, false, this.mvp(view));
    gl.uniform3f(this.uColor, 0.91, 0.93, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  getStats() {
    const info = this.atlas?.info;
    return {
      atlasBytes: info ? info.atlasW * info.atlasH * 4 : 0,
      atlasSize: info ? `${info.atlasW}×${info.atlasH}` : '-',
      gpuBufferBytes: this.bufferBytes,
      vertices: this.vertexCount,
      regenerations: this.regenerations,
      source: this.atlas?.source ?? '-',
    };
  }
}
