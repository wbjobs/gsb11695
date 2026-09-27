/**
 * LRU cache with byte-budget accounting, used by the glyph-cache renderer.
 * Pure module (no DOM) so it can be unit-tested in Node.
 */
export class LRUCache {
  constructor(budgetBytes) {
    this.budgetBytes = budgetBytes;
    this.map = new Map(); // key -> { value, bytes }
    this.bytes = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Insert without touching hit/miss stats (entry was just created). */
  put(key, value, bytes) {
    const old = this.map.get(key);
    if (old) this.#remove(key);
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    this.#evictToBudget();
  }

  peek(key) {
    return this.map.get(key)?.value;
  }

  #remove(key) {
    const entry = this.map.get(key);
    if (!entry) return;
    this.map.delete(key);
    this.bytes -= entry.bytes;
  }

  #evictToBudget() {
    while (this.bytes > this.budgetBytes && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value;
      this.#remove(oldestKey);
      this.stats.evictions++;
    }
  }

  setBudget(budgetBytes) {
    this.budgetBytes = budgetBytes;
    this.#evictToBudget();
  }

  invalidate() {
    this.map.clear();
    this.bytes = 0;
    this.stats.invalidations++;
  }

  get size() {
    return this.map.size;
  }
}
