// 性能监控：PerformanceObserver(longtask/measure) + 逐帧统计。

export class PerfMonitor {
  constructor() {
    this.frames = [];            // 最近 120 帧的帧间隔
    this.renderTimes = [];       // 最近 120 次渲染耗时
    this.longTasks = { count: 0, total: 0, max: 0 };
    this.measures = new Map();   // name -> {count,total,max,last}
    this.lastFrameTs = 0;
    this._observer = null;
  }

  start() {
    if (!('PerformanceObserver' in window)) return;
    this._observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'longtask') {
          this.longTasks.count++;
          this.longTasks.total += entry.duration;
          this.longTasks.max = Math.max(this.longTasks.max, entry.duration);
        } else if (entry.entryType === 'measure') {
          const m = this.measures.get(entry.name) || { count: 0, total: 0, max: 0, last: 0 };
          m.count++; m.total += entry.duration;
          m.max = Math.max(m.max, entry.duration);
          m.last = entry.duration;
          this.measures.set(entry.name, m);
        }
      }
    });
    try {
      this._observer.observe({ entryTypes: ['longtask', 'measure'] });
    } catch {
      this._observer.observe({ entryTypes: ['measure'] }); // Safari 无 longtask
    }
  }

  frame(renderMs) {
    const now = performance.now();
    if (this.lastFrameTs) {
      this.frames.push(now - this.lastFrameTs);
      if (this.frames.length > 120) this.frames.shift();
    }
    this.lastFrameTs = now;
    this.renderTimes.push(renderMs);
    if (this.renderTimes.length > 120) this.renderTimes.shift();
  }

  avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  liveStats() {
    const frameAvg = this.avg(this.frames);
    return {
      fps: frameAvg ? 1000 / frameAvg : 0,
      frameMs: frameAvg,
      renderMs: this.avg(this.renderTimes),
    };
  }

  measureSummary() {
    const lines = [];
    for (const [name, m] of this.measures) {
      lines.push(`${name}: 均 ${(m.total / m.count).toFixed(2)}ms 最大 ${m.max.toFixed(2)}ms (n=${m.count})`);
    }
    return lines;
  }
}

// 基准测试：对当前方案连续渲染 frames 帧，返回量化指标。
export function benchmark(renderOnce, frames = 120) {
  return new Promise((resolve) => {
    const renderTimes = [];
    const frameTimes = [];
    let last = 0;
    let i = 0;
    function tick(ts) {
      if (last) frameTimes.push(ts - last);
      last = ts;
      const t0 = performance.now();
      renderOnce();
      renderTimes.push(performance.now() - t0);
      if (++i < frames) requestAnimationFrame(tick);
      else {
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const frameAvg = avg(frameTimes);
        resolve({
          frameMs: frameAvg,
          renderMs: avg(renderTimes),
          fps: frameAvg ? 1000 / frameAvg : 0,
        });
      }
    }
    requestAnimationFrame(tick);
  });
}
