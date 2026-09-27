/**
 * Shared 2D view-transform helpers for the canvas renderers.
 * View maps text space -> screen CSS px:
 *   screen = translate(cx,cy) * rotate(rot) * scale(s) * translate(-ax,-ay) * text
 */

export function applyViewTransform(ctx, view) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.translate(view.cx, view.cy);
  ctx.rotate(view.rotation);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.ax, -view.ay);
}

/** Inverse of the view transform: screen CSS px -> text space. */
export function makeInverseTransform(view) {
  const cos = Math.cos(-view.rotation);
  const sin = Math.sin(-view.rotation);
  return (px, py) => {
    const dx = px - view.cx;
    const dy = py - view.cy;
    const rx = (dx * cos - dy * sin) / view.scale;
    const ry = (dx * sin + dy * cos) / view.scale;
    return [rx + view.ax, ry + view.ay];
  };
}
