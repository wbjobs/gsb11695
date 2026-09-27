// 确定性伪随机文本生成：中英混排，控制唯一字符数量以适配图集容量。

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUNCT = ' ,.!?;:-_()[]{}<>/\\|@#$%^&*+=~`\'"';

// 500 个常用汉字区间采样，保证图集可容纳（48px 单元、2048 图集 => 1764 格）。
function buildCjkPool() {
  let s = '';
  for (let i = 0; i < 500; i++) s += String.fromCharCode(0x4e00 + i * 7);
  return s;
}

export const CHAR_POOL = LATIN + DIGITS + PUNCT + buildCjkPool();

export function generateText(count, seed = 42) {
  const rand = mulberry32(seed);
  const pool = CHAR_POOL;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = rand();
    if (r < 0.08) out[i] = '\n';
    else out[i] = pool[(rand() * pool.length) | 0];
  }
  return out.join('');
}

export function uniqueChars(text) {
  return [...new Set(text)].filter((c) => c !== '\n' && c !== ' ');
}
