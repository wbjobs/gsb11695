// 主控：UI 绑定、渲染循环、方案切换、字体加载、缓存失效、降级与基准测试。

import { generateText, uniqueChars } from './text.js';
import { makeLayout } from './layout.js';
import { PerfMonitor, benchmark } from './perf.js';
import { FontManager, SYSTEM_FONTS } from './font-loader.js';
import { GlyphCacheRenderer } from './renderers/glyph-cache.js';
import { BitmapFontRenderer } from './renderers/bitmap-font.js';
import { SDFontRenderer } from './renderers/sdf-font.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas2d = $('canvas2d');
const canvasgl = $('canvasgl');
const ctx2d = canvas2d.getContext('2d');

const perf = new PerfMonitor();
const fontManager = new FontManager();

const state = {
  scheme: 'glyph',
  fontKey: 'system-sans',
  fontSize: 16,
  scale: 1,
  rotation: 0,
  scrollX: 0,
  scrollY: 0,
  charCount: 100000,
  text: '',
  chars: [],
  layout: null,
};

const glyph = new GlyphCacheRenderer();
const bitmap = new BitmapFontRenderer();
let sdf = null;
let sdfError = null;
let frameNo = 0;

// ---------- 视图与布局 ----------

function currentView() {
  return {
    width: canvas2d.width, height: canvas2d.height,
    scrollX: state.scrollX, scrollY: state.scrollY,
    scale: state.scale, rotation: state.rotation, fontSize: state.fontSize,
  };
}

function rebuildLayout() {
  state.layout = makeLayout(state.text, canvas2d.width, state.fontSize);
  clampScroll();
}

function clampScroll() {
  const maxY = Math.max(0, state.layout.height - canvas2d.height / state.scale);
  state.scrollY = Math.min(Math.max(0, state.scrollY), maxY);
  state.scrollX = Math.min(Math.max(0, state.scrollX), canvas2d.width);
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const c of [canvas2d, canvasgl]) { c.width = w; c.height = h; }
  rebuildLayout();
}

// ---------- 文本 ----------

function setText(count) {
  state.charCount = count;
  state.text = generateText(count);
  state.chars = uniqueChars(state.text);
  rebuildLayout();
  bitmap.setFont(currentFamily(), state.chars);
  glyph.invalidate('text-change');
  refreshSdf(); // 文本变化后重建 SDF 图集
}

// ---------- 字体 ----------

function currentFamily() {
  return fontManager.resolveFamily(state.fontKey).family;
}

async function applyFont() {
  const { family, label } = currentFamilyInfo();
  $('fontStatus').textContent = `当前字体: ${label}`;
  glyph.setFont(family);
  glyph.invalidate('font-change');
  bitmap.setFont(family, state.chars);
  await refreshSdf();
}

function currentFamilyInfo() {
  const info = fontManager.resolveFamily(state.fontKey);
  return info;
}

async function addFontOption(id, name, select = true) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = `自定义: ${name}`;
  $('fontSelect').appendChild(opt);
  if (select) { $('fontSelect').value = id; state.fontKey = id; }
}

// ---------- SDF 构建与降级 ----------

async function ensureSdf() {
  if ($('simulateSdfFail').checked) throw new Error('模拟 SDF 构建失败');
  if (!sdf) sdf = new SDFontRenderer(canvasgl); // WebGL 不可用时构造即抛错
  if (sdfError) throw sdfError;
}

async function refreshSdf() {
  try {
    sdfError = null;
    await ensureSdf();
    await sdf.setFont(currentFamily(), state.chars);
    hideBanner();
    if (state.scheme === 'sdf') showCanvas('gl');
  } catch (e) {
    sdfError = e;
    if (state.scheme === 'sdf') {
      showBanner(`SDF 不可用（${e.message || e}），已自动降级到位图字体`);
      setSchemeUI('bitmap');
    }
  }
}

function showBanner(msg) {
  $('fallbackBanner').textContent = msg;
  $('fallbackBanner').classList.remove('hidden');
}
function hideBanner() { $('fallbackBanner').classList.add('hidden'); }

function showCanvas(which) {
  canvas2d.classList.toggle('hidden', which !== '2d');
  canvasgl.classList.toggle('hidden', which !== 'gl');
}

// ---------- 方案切换 ----------

function activeRenderer() {
  if (state.scheme === 'glyph') return glyph;
  if (state.scheme === 'bitmap') return bitmap;
  return sdf;
}

async function setSchemeUI(scheme) {
  state.scheme = scheme;
  document.querySelector(`input[name="scheme"][value="${scheme}"]`).checked = true;
  showCanvas(scheme === 'sdf' ? 'gl' : '2d');
}

async function onSchemeChange(scheme) {
  if (scheme === 'sdf') {
    try {
      await ensureSdf();
      if (!sdf.glyphCount) await sdf.setFont(currentFamily(), state.chars);
      hideBanner();
    } catch (e) {
      sdfError = e;
      showBanner(`SDF 不可用（${e.message || e}），已自动降级到位图字体`);
      await setSchemeUI('bitmap');
      return;
    }
  }
  await setSchemeUI(scheme);
}

// ---------- 渲染循环 ----------

function renderActive() {
  const view = currentView();
  if (state.scheme === 'sdf' && sdf && !sdfError) {
    sdf.render(view, state.layout);
    return;
  }
  // SDF 异常时兜底位图字体，保证画布始终有正确输出
  const renderer = state.scheme === 'sdf' ? bitmap : activeRenderer();
  if (state.scheme === 'sdf') showCanvas('2d');
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.fillStyle = '#141518';
  ctx2d.fillRect(0, 0, canvas2d.width, canvas2d.height);
  renderer.render(ctx2d, view, state.layout);
}

function loop() {
  const t0 = performance.now();
  renderActive();
  const ms = performance.now() - t0;
  perf.frame(ms);
  if (frameNo % 60 === 0) {
    performance.mark('r-start');
    renderActive();
    performance.mark('r-end');
    performance.measure(`render:${state.scheme}`, 'r-start', 'r-end');
  }
  frameNo++;
  requestAnimationFrame(loop);
}

// ---------- 统计面板 ----------

function updatePanels() {
  const live = perf.liveStats();
  const r = activeRenderer();
  const extra = r && r.getStats ? r.getStats() : {};
  const lines = [
    `方案: ${state.scheme}   FPS: ${live.fps.toFixed(1)}   帧均: ${live.frameMs.toFixed(2)}ms   渲染: ${live.renderMs.toFixed(2)}ms`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ];
  $('live').textContent = lines.join('\n');
  const lt = perf.longTasks;
  const measures = perf.measureSummary().slice(-6);
  $('observerStats').textContent =
    `PerformanceObserver\n长任务: ${lt.count} 次 / 共 ${lt.total.toFixed(0)}ms / 最大 ${lt.max.toFixed(0)}ms\n` +
    (measures.length ? measures.join('\n') : '（暂无 measure 记录）');
}

// ---------- 基准测试 ----------

async function runBenchmark() {
  $('benchBtn').disabled = true;
  const tbody = document.querySelector('#benchTable tbody');
  tbody.innerHTML = '';
  const results = [];
  for (const s of ['glyph', 'bitmap', 'sdf']) {
    if (s === 'sdf' && sdfError) {
      results.push({ name: s, error: `不可用（${sdfError.message || sdfError}）` });
      continue;
    }
    await onSchemeChange(s);
    if (state.scheme !== s) { results.push({ name: s, error: '不可用（已降级）' }); continue; }
    await invalidateActive();
    performance.mark('cold-start');
    renderActive();
    performance.mark('cold-end');
    performance.measure(`冷启动:${s}`, 'cold-start', 'cold-end');
    const cold = performance.getEntriesByName(`冷启动:${s}`).pop().duration;
    const r = await benchmark(() => renderActive(), 120);
    results.push({ name: s, ...r, cold });
  }
  const NAMES = { glyph: '字形缓存', bitmap: '位图字体', sdf: 'SDF 字体' };
  for (const r of results) {
    const tr = document.createElement('tr');
    tr.innerHTML = r.error
      ? `<td>${NAMES[r.name]}</td><td colspan="4">${r.error}</td>`
      : `<td>${NAMES[r.name]}</td><td>${r.frameMs.toFixed(2)}</td><td>${r.renderMs.toFixed(2)}</td><td>${r.fps.toFixed(1)}</td><td>${r.cold.toFixed(1)}</td>`;
    tbody.appendChild(tr);
  }
  $('benchTable').classList.remove('hidden');
  $('benchBtn').disabled = false;
}

async function invalidateActive() {
  const r = activeRenderer();
  if (state.scheme === 'sdf' && sdf) { await refreshSdf(); return; }
  if (r && r.invalidate) r.invalidate();
}

// ---------- 事件绑定 ----------

function bindUI() {
  document.querySelectorAll('input[name="scheme"]').forEach((el) => {
    el.addEventListener('change', () => onSchemeChange(el.value));
  });
  $('simulateSdfFail').addEventListener('change', (e) => {
    if (e.target.checked && state.scheme === 'sdf') {
      sdfError = new Error('模拟 SDF 构建失败');
      showBanner('SDF 不可用（模拟失败），已自动降级到位图字体');
      setSchemeUI('bitmap');
    } else if (!e.target.checked) {
      sdfError = null;
      refreshSdf();
    }
  });
  $('fontSelect').addEventListener('change', (e) => { state.fontKey = e.target.value; applyFont(); });
  $('fontSize').addEventListener('input', (e) => {
    state.fontSize = +e.target.value;
    $('fontSizeVal').textContent = e.target.value;
    rebuildLayout();
  });
  $('scale').addEventListener('input', (e) => {
    state.scale = +e.target.value / 100;
    $('scaleVal').textContent = state.scale.toFixed(2);
    clampScroll();
  });
  $('rotation').addEventListener('input', (e) => {
    state.rotation = +e.target.value;
    $('rotationVal').textContent = e.target.value;
  });
  $('charCount').addEventListener('change', (e) => setText(+e.target.value));
  $('cacheBudget').addEventListener('change', (e) => glyph.setBudgetMB(+e.target.value));
  $('invalidateBtn').addEventListener('click', () => invalidateActive());
  $('benchBtn').addEventListener('click', runBenchmark);
  $('clearFontCacheBtn').addEventListener('click', async () => {
    await fontManager.clearAll();
    $('fontSelect').innerHTML = Object.keys(SYSTEM_FONTS)
      .map((k) => `<option value="${k}">系统 ${SYSTEM_FONTS[k]}</option>`).join('');
    state.fontKey = 'system-sans';
    await applyFont();
  });
  $('loadUrlBtn').addEventListener('click', async () => {
    const url = $('fontUrl').value.trim();
    if (!url) return;
    $('fontStatus').textContent = '下载字体中…';
    try {
      const f = await fontManager.loadFromUrl(url);
      await addFontOption(f.id, f.name);
      await applyFont();
    } catch (e) {
      $('fontStatus').textContent = `加载失败: ${e.message}`;
    }
  });
  $('fontFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const f = await fontManager.loadFromFile(file);
      await addFontOption(f.id, f.name);
      await applyFont();
    } catch (err) {
      $('fontStatus').textContent = `加载失败: ${err.message}`;
    }
  });

  // 滚轮滚动 + 拖拽平移
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.scrollY += e.deltaY / state.scale;
    state.scrollX += e.deltaX / state.scale;
    clampScroll();
  }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.scrollX -= (e.clientX - drag.x) / state.scale;
    state.scrollY -= (e.clientY - drag.y) / state.scale;
    drag = { x: e.clientX, y: e.clientY };
    clampScroll();
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  new ResizeObserver(resize).observe(stage);
}

// ---------- 启动 ----------

async function init() {
  perf.start();
  bindUI();
  resize();
  setText(state.charCount);
  const restored = await fontManager.restore();
  for (const f of restored) await addFontOption(f.id, f.name, false);
  await applyFont();
  requestAnimationFrame(loop);
  setInterval(updatePanels, 300);
}

init();
