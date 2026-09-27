/**
 * Performance instrumentation built on PerformanceObserver.
 * - 'measure' entries (created via PerfMonitor.measure) feed per-label stats
 * - 'longtask' entries are counted to surface main-thread jank
 */

const MAX_SAMPLES = 240;

export class PerfMonitor {
  constructor() {
    this.samples = new Map(); // label -> number[]
    this.longtasks = 0;
    this.longtaskTime = 0;
    this.observer = null;
  }

  start() {
    if (this.observer) return;
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'measure') {
          const arr = this.samples.get(entry.name) ?? [];
          arr.push(entry.duration);
          if (arr.length > MAX_SAMPLES) arr.shift();
          this.samples.set(entry.name, arr);
        } else if (entry.entryType === 'longtask') {
          this.longtasks++;
          this.longtaskTime += entry.duration;
        }
      }
    });
    const types = [];
    for (const t of ['measure', 'longtask']) {
      if (PerformanceObserver.supportedEntryTypes?.includes(t)) types.push(t);
    }
    this.observer.observe({ entryTypes: types });
  }

  /** Time a synchronous render pass as a performance measure. */
  measure(label, fn) {
    const startMark = `${label}:start`;
    performance.clearMarks(startMark);
    performance.mark(startMark);
    try {
      return fn();
    } finally {
      performance.measure(label, startMark);
    }
  }

  reset(label) {
    if (label) {
      this.samples.delete(label);
      performance.clearMeasures(label);
    } else {
      this.samples.clear();
      performance.clearMeasures();
      this.longtasks = 0;
      this.longtaskTime = 0;
    }
  }

  stats(label) {
    const arr = this.samples.get(label) ?? [];
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = sum / arr.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return {
      count: arr.length,
      avg,
      p95,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      fps: avg > 0 ? 1000 / avg : 0,
    };
  }
}
