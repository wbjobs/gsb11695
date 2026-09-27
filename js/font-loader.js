// 字体管理：FontFace API 加载 + IndexedDB 持久化缓存。

import { idb } from './idb.js';

export const SYSTEM_FONTS = {
  'system-sans': 'sans-serif',
  'system-serif': 'serif',
  'system-mono': 'monospace',
};

export class FontManager {
  constructor() {
    this.custom = new Map(); // id -> { id, name, family, buffer }
  }

  // 启动时从 IndexedDB 恢复已缓存字体。
  async restore() {
    let records = [];
    try { records = await idb.listFonts(); } catch { /* IDB 不可用时静默降级 */ }
    for (const rec of records) {
      try {
        await this._register(rec.id, rec.name, rec.buffer, false);
      } catch (e) {
        console.warn('恢复字体失败', rec.name, e);
      }
    }
    return [...this.custom.values()].map((f) => ({ id: f.id, name: f.name }));
  }

  async loadFromUrl(url) {
    const id = `url:${url}`;
    const cached = await idb.getFont(id).catch(() => null);
    if (cached) return this._register(id, cached.name, cached.buffer, false);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`下载字体失败: HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const name = decodeURIComponent(url.split('/').pop() || 'webfont');
    await idb.putFont({ id, name, buffer, savedAt: Date.now() }).catch(() => {});
    return this._register(id, name, buffer, true);
  }

  async loadFromFile(file) {
    const buffer = await file.arrayBuffer();
    const id = `file:${file.name}:${file.size}`;
    await idb.putFont({ id, name: file.name, buffer, savedAt: Date.now() }).catch(() => {});
    return this._register(id, file.name, buffer, true);
  }

  async _register(id, name, buffer, isNew) {
    if (this.custom.has(id)) return this.custom.get(id);
    const family = `user-font-${this.custom.size}`;
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    const record = { id, name, family, buffer };
    this.custom.set(id, record);
    return { ...record, isNew };
  }

  resolveFamily(key) {
    if (key in SYSTEM_FONTS) return { family: SYSTEM_FONTS[key], buffer: null, label: key };
    const f = this.custom.get(key);
    if (!f) throw new Error(`未知字体: ${key}`);
    return { family: f.family, buffer: f.buffer, label: f.name };
  }

  async clearAll() {
    this.custom.clear();
    await idb.clearFonts().catch(() => {});
  }
}
