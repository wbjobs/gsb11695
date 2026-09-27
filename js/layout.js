// 网格布局与视图变换：三种渲染器共用，保证对照公平。

export function makeLayout(text, viewportW, fontSize) {
  const cell = fontSize;
  const cols = Math.max(1, Math.floor(viewportW / cell));
  const chars = [];
  const rowStart = [0]; // 每行在 chars 中的起始下标
  let col = 0, row = 0;
  for (const ch of text) {
    if (ch === '\n' || col >= cols) {
      rowStart.push(chars.length);
      col = 0; row++;
      if (ch === '\n') continue;
    }
    chars.push({ ch, x: col * cell, y: row * cell });
    col++;
  }
  rowStart.push(chars.length);
  return { chars, rowStart, cell, cols, rows: row + 1, height: (row + 1) * cell };
}

// 视图变换：先平移(-scrollX,-scrollY)，再绕画布中心缩放/旋转。
// screen = C + R(θ)·S(s)·(p - C)，2D 仿射: [a c e; b d f]
export function viewMatrix(view) {
  const { width, height, scrollX, scrollY, scale, rotation } = view;
  const cx = width / 2, cy = height / 2;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad) * scale, sin = Math.sin(rad) * scale;
  const a = cos, b = sin, c = -sin, d = cos;
  const e = cx - a * (cx + scrollX) - c * (cy + scrollY);
  const f = cy - b * (cx + scrollX) - d * (cy + scrollY);
  return { a, b, c, d, e, f };
}

export function invertMatrix(m) {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  const ie = -(ia * m.e + ic * m.f);
  const if_ = -(ib * m.e + id * m.f);
  return { a: ia, b: ib, c: ic, d: id, e: ie, f: if_ };
}

export function applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// 由视口四角反推内容包围盒，得到需要遍历的行范围（保守裁剪）。
export function visibleRowRange(view, layout) {
  const inv = invertMatrix(viewMatrix(view));
  const corners = [
    applyMatrix(inv, 0, 0),
    applyMatrix(inv, view.width, 0),
    applyMatrix(inv, 0, view.height),
    applyMatrix(inv, view.width, view.height),
  ];
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const { cell, rows } = layout;
  return {
    row0: Math.max(0, Math.floor(minY / cell) - 1),
    row1: Math.min(rows - 1, Math.ceil(maxY / cell) + 1),
    minX, maxX,
  };
}
