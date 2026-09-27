/**
 * App orchestration: UI state, renderer lifecycle, layout, view transform,
 * benchmark runs, and the acceptance flows (font switch re-render, cache
 * invalidation, memory budget, SDF -> bitmap degradation).
 */
import { loadFont } from './font-manager.js';
import { generateText, uniqueChars } from './text-gen.js';
import { computeLayout } from './layout.js';
import { PerfMonitor } from './perf.js';
import { dbClear } from './db.js';
import { GlyphCacheRenderer } from './renderers/glyph-cache.js';
import { BitmapFontRenderer } from './renderers/bitmap-font.js';
import { SdfFontRenderer, SdfUnavailableError } from './renderers/sdf-font.js';

const SCHEMES = {
  'glyph-cache': { label: '字形缓存', canvas: '2d' },
  'bitmap': { label: '位图字体', canvas: '2d' },
  'sdf': { label: 'SDF 字体', canvas: 'gl' },
};

const $ = (id) => document.getElementById(id);
const els = {
  scheme: $('schemeSelect'), font: $('fontSelect'), count: $('charCount'),
  scale: $('scaleRange'), scaleVal: $('scaleVal'),
  rotation: $('rotationRange'), rotVal: $('rotVal'),
  budget: $('budgetInput'),
  invalidate: $('invalidateBtn'), regen: $('regenBtn'), bench: $('benchBtn'),
  anim: $('animToggle'), fit: $('fitBtn'),
  canvas2d: $('canvas2d'), canvasgl: $('canvasgl'), wrap: $('canvasWrap'),
  status: $('statusLine'), stats: $('statsPanel'),
  benchBody: $('benchBody'), log: $('logPanel'),
};

const perf = new PerfMonitor();
const state = {
  scheme: 'glyph-cache',
  font: null,
  text: '',
  chars: [],
  layout: null,
  userScale: 1,
  rotationDeg: 0,
  fitScale: 1,
  animating: false,
  renderers: {}, // scheme -> renderer instance (lazy)
};

function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = document.createElement('div');
  line.textContent = `[${time}] ${msg}`;
  els.log.prepend(line);
  while (els.log.childElementCount > 60) els.log.lastChild.remove();
}

function setStatus(msg) {
  els.status.textContent = msg;
}

function activeRenderer() {
  return state.renderers[state.scheme];
}

function getRenderer(name) {
  if (state.renderers[name]) return state.renderers[name];
  let r;
  if (name === 'glyph-cache') r = new GlyphCacheRenderer(els.canvas2d);
  else if (name === 'bitmap') r = new BitmapFontRenderer(els.canvas2d);
  else r = new SdfFontRenderer(els.canvasgl); // may throw SdfUnavailableError
  if (name === 'glyph-cache') r.setBudget(Number(els.budget.value) * 1024 * 1024);
  state.renderers[name] = r;
  return r;
}

function canvasSize() {
  const rect = els.wrap.getBoundingClientRect();
  return { cssW: rect.width, cssH: rect.height, dpr: window.devicePixelRatio || 1 };
}

function resizeCanvases() {
  const { cssW, cssH, dpr } = canvasSize();
  for (const c of [els.canvas2d, els.canvasgl]) {
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
  }
  updateFitScale();
}

function updateFitScale() {
  if (!state.layout) return;
  const { cssW, cssH } = canvasSize();
  state.fitScale = 0.92 * Math.min(cssW / state.layout.width, cssH / state.layout.height);
}

function currentView() {
  const { cssW, cssH, dpr } = canvasSize();
  return {
    scale: state.fitScale * state.userScale,
    rotation: (state.rotationDeg * Math.PI) / 180,
    cx: cssW / 2, cy: cssH / 2,
    ax: state.layout ? state.layout.width / 2 : 0,
    ay: state.layout ? state.layout.height / 2 : 0,
    dpr, cssW, cssH,
  };
}

function renderFrame() {
  const renderer = activeRenderer();
  if (!renderer || !state.layout) return;
  perf.measure(`render:${state.scheme}`, () => renderer.render(currentView()));
}

function relayout() {
  const renderer = activeRenderer();
  if (!renderer) return;
  state.layout = computeLayout(state.text, (ch) => renderer.measureAdvance(ch));
  renderer.setLayout(state.layout, state.text);
  updateFitScale();
}

async function prepareRenderer(name, { forceRegenerate = false } = {}) {
  const renderer = getRenderer(name);
  await renderer.prepare({
    font: state.font,
    chars: state.chars,
    forceRegenerate,
    onProgress: (p) => setStatus(`生成${p.kind === 'sdf' ? ' SDF ' : ' 位图 '}图集 ${p.done}/${p.total}…`),
  });
  return renderer;
}

async function activateScheme(name) {
  try {
    await prepareRenderer(name);
  } catch (err) {
    if (err instanceof SdfUnavailableError && name === 'sdf') {
      log(`SDF 方案不可用（${err.message}），已降级到位图字体`);
      name = 'bitmap';
      els.scheme.value = 'bitmap';
      await prepareRenderer(name);
    } else {
      throw err;
    }
  }
  state.scheme = name;
  const useGL = SCHEMES[name].canvas === 'gl';
  els.canvasgl.style.display = useGL ? 'block' : 'none';
  els.canvas2d.style.display = useGL ? 'none' : 'block';
  relayout();
  renderFrame();
}

async function applyFont(fontId) {
  setStatus('字体加载中…');
  const font = await loadFont(fontId);
  state.font = font;
  log(`字体加载完成（来源：${font.source === 'idb' ? 'IndexedDB 缓存' : '网络获取'}），触发重渲染`);
  for (const name of Object.keys(state.renderers)) {
    await prepareRenderer(name);
  }
  if (state.renderers['glyph-cache']) {
    log('字体切换：字形缓存已自动失效');
  }
  relayout();
  renderFrame();
  setStatus('就绪');
}

async function regenerateText() {
  const count = Math.max(1000, Math.min(300000, Number(els.count.value) || 100000));
  els.count.value = count;
  state.text = generateText(count, Date.now() % 100000);
  state.chars = uniqueChars(state.text);
  log(`文本重新生成：${count.toLocaleString()} 字符，${state.chars.length} 个唯一字符`);
  for (const name of Object.keys(state.renderers)) {
    await prepareRenderer(name);
  }
  relayout();
  renderFrame();
}

async function invalidateCaches() {
  const glyph = state.renderers['glyph-cache'];
  if (glyph) glyph.invalidate();
  await dbClear('atlases');
  log('缓存失效：字形缓存已清空，IndexedDB 图集已清空');
  setStatus('重新生成图集…');
  for (const name of Object.keys(state.renderers)) {
    if (name === 'glyph-cache') continue;
    await prepareRenderer(name, { forceRegenerate: true });
  }
  relayout();
  renderFrame();
  log('图集重新生成完成，已重渲染');
  setStatus('就绪');
}

function runFrames(n) {
  return new Promise((resolve) => {
    const step = () => {
      renderFrame();
      if (--n > 0) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function memoryNote(name) {
  const r = state.renderers[name];
  if (!r) return '-';
  const s = r.getStats();
  if (name === 'glyph-cache') return `缓存 ${fmtBytes(s.bytes)} / ${s.entries} 项`;
  if (name === 'bitmap') return `图集 ${s.atlasSize}（${fmtBytes(s.atlasBytes)}）`;
  return `图集 ${s.atlasSize} + 顶点 ${fmtBytes(s.gpuBufferBytes)}`;
}

async function runBenchmark() {
  els.bench.disabled = true;
  const prev = state.scheme;
  els.benchBody.innerHTML = '';
  for (const name of Object.keys(SCHEMES)) {
    const row = document.createElement('tr');
    try {
      setStatus(`基准测试：${SCHEMES[name].label}…`);
      await activateScheme(name);
      perf.reset(`render:${state.scheme}`);
      await runFrames(60);
      const st = perf.stats(`render:${state.scheme}`);
      row.innerHTML = `<td>${SCHEMES[state.scheme].label}</td>`
        + `<td>${st.avg.toFixed(2)}</td><td>${st.p95.toFixed(2)}</td>`
        + `<td>${st.fps.toFixed(1)}</td><td>${memoryNote(state.scheme)}</td>`
        + `<td>${state.scheme === name ? '正常' : '降级到位图'}</td>`;
    } catch (err) {
      row.innerHTML = `<td>${SCHEMES[name].label}</td><td colspan="5">失败：${err.message}</td>`;
    }
    els.benchBody.appendChild(row);
  }
  await activateScheme(prev in SCHEMES ? prev : 'glyph-cache');
  setStatus('基准测试完成');
  log('基准测试完成：三方案各渲染 60 帧，统计见对照表');
  els.bench.disabled = false;
}

function refreshStats() {
  const r = activeRenderer();
  const label = `render:${state.scheme}`;
  const st = perf.stats(label);
  const lines = [];
  lines.push(`方案：${SCHEMES[state.scheme].label}`);
  if (st) {
    lines.push(`帧耗时 avg ${st.avg.toFixed(2)} ms / p95 ${st.p95.toFixed(2)} ms（≈${st.fps.toFixed(1)} FPS）`);
  } else {
    lines.push('帧耗时：暂无采样（交互或开启连续渲染）');
  }
  lines.push(`长任务（longtask）：${perf.longtasks} 次 / ${perf.longtaskTime.toFixed(0)} ms`);
  if (r) {
    const s = r.getStats();
    if (state.scheme === 'glyph-cache') {
      lines.push(`缓存：命中 ${s.hits} / 未命中 ${s.misses} / 淘汰 ${s.evictions} / 失效 ${s.invalidations} 次`);
      lines.push(`缓存内存：${fmtBytes(s.bytes)} / 预算 ${fmtBytes(s.budget)}（${s.entries} 项）`);
    } else {
      lines.push(`图集：${s.atlasSize}（${fmtBytes(s.atlasBytes)}），来源 ${s.source === 'idb' ? 'IndexedDB' : 'Worker 生成'}，重建 ${s.regenerations} 次`);
      if (s.gpuBufferBytes !== undefined) lines.push(`GPU 顶点缓冲：${fmtBytes(s.gpuBufferBytes)}（${s.vertices} 顶点）`);
    }
  }
  els.stats.textContent = lines.join('\n');
}

function bindUI() {
  els.scheme.addEventListener('change', () => activateScheme(els.scheme.value).catch((e) => log(`方案切换失败：${e.message}`)));
  els.font.addEventListener('change', () => applyFont(els.font.value).catch((e) => log(`字体加载失败：${e.message}`)));
  els.scale.addEventListener('input', () => {
    state.userScale = Number(els.scale.value) / 100;
    els.scaleVal.textContent = `${state.userScale.toFixed(2)}×`;
    if (!state.animating) renderFrame();
  });
  els.rotation.addEventListener('input', () => {
    state.rotationDeg = Number(els.rotation.value);
    els.rotVal.textContent = `${state.rotationDeg}°`;
    if (!state.animating) renderFrame();
  });
  els.budget.addEventListener('change', () => {
    const bytes = Math.max(1, Number(els.budget.value) || 32) * 1024 * 1024;
    state.renderers['glyph-cache']?.setBudget(bytes);
    log(`字形缓存内存预算调整为 ${els.budget.value} MB`);
    if (!state.animating) renderFrame();
  });
  els.fit.addEventListener('click', () => {
    state.userScale = 1;
    state.rotationDeg = 0;
    els.scale.value = 100;
    els.rotation.value = 0;
    els.scaleVal.textContent = '1.00×';
    els.rotVal.textContent = '0°';
    renderFrame();
  });
  els.invalidate.addEventListener('click', () => invalidateCaches().catch((e) => log(`缓存失效失败：${e.message}`)));
  els.regen.addEventListener('click', () => regenerateText().catch((e) => log(`文本生成失败：${e.message}`)));
  els.bench.addEventListener('click', () => runBenchmark().catch((e) => log(`基准测试失败：${e.message}`)));
  els.anim.addEventListener('change', () => {
    state.animating = els.anim.checked;
    if (state.animating) {
      const loop = () => {
        if (!state.animating) return;
        renderFrame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  });
  new ResizeObserver(() => {
    resizeCanvases();
    if (!state.animating) renderFrame();
  }).observe(els.wrap);
}

async function init() {
  perf.start();
  bindUI();
  resizeCanvases();
  state.text = generateText(Number(els.count.value) || 100000, 11695);
  state.chars = uniqueChars(state.text);
  await applyFont(els.font.value);
  await activateScheme(els.scheme.value);
  setStatus('就绪');
  log(`初始化完成：${state.text.length.toLocaleString()} 字符，${state.chars.length} 个唯一字符`);
  setInterval(refreshStats, 250);
}

init().catch((e) => {
  setStatus(`初始化失败：${e.message}`);
  log(`初始化失败：${e.message}`);
});
