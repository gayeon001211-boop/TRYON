// The three built-in frames as GlassesAssets, so they flow through the same asset
// renderer as an uploaded frame. Outlines are hand-authored point rings (model space:
// x right, y up, frame width ≈ 1). Users start from one and adjust, or upload their own.

function arc(cx, cy, rx, ry, a0, a1, n) {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return p;
}
function ellipse(cx, cy, rx, ry, n = 28) { return arc(cx, cy, rx, ry, 0, Math.PI * 2 * (n - 1) / n, n - 1); }

function frame(outline, lensL, lensR, over = {}) {
  return {
    ok: true, preset: true,
    geometry: {
      outline, lensL, lensR,
      bridge: { x: 0, yTop: 0.12, width: 0.16 },
      hingeL: outline.reduce((a, b) => (b[0] < a[0] ? b : a)),
      hingeR: outline.reduce((a, b) => (b[0] > a[0] ? b : a)),
    },
    dimensions: { aspect: 2.6, rimRatio: 0.07, templeLen: 1.05, templeDrop: 0.12, depth: 0.055, ...over.dimensions },
    frameColor: '#171717', lensColor: '#ffffff', lensOpacity: 0.07,
    placement: { spanRatio: 1.5, yRatio: -0.06 },
    quality: { hasHoles: true, contourPoints: outline.length, score: 1 },
  };
}

function roundedRect(cx, cy, w, h, r) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [
    ...arc(x1 - r, y1 - r, r, r, 0, Math.PI / 2, 4),
    ...arc(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, 4),
    ...arc(x0 + r, y0 + r, r, r, Math.PI, Math.PI * 1.5, 4),
    ...arc(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, 4),
  ];
}
function catLens(cx, sign) {
  return [
    [cx - 0.20, 0.17], [cx - 0.04 * sign, 0.20], [cx + 0.20, 0.14],
    [cx + 0.21, 0.0], [cx + 0.14, -0.14], [cx - 0.03, -0.17],
    [cx - 0.19, -0.12], [cx - 0.21, 0.05],
  ];
}

export const PRESETS = [
  {
    id: 'round', name: 'round',
    asset: frame(
      ellipse(0, 0, 0.56, 0.25),
      ellipse(-0.30, 0, 0.21, 0.18), ellipse(0.30, 0, 0.21, 0.18)),
  },
  {
    id: 'square', name: 'square',
    asset: frame(
      roundedRect(0, 0, 1.10, 0.48, 0.06),
      roundedRect(-0.29, 0, 0.42, 0.32, 0.05), roundedRect(0.29, 0, 0.42, 0.32, 0.05),
      { dimensions: { aspect: 2.3 } }),
  },
  {
    id: 'cat', name: 'cat-eye',
    asset: frame(
      [[-0.53, 0.16], [-0.30, 0.24], [-0.05, 0.20], [0, 0.12], [0.05, 0.20], [0.30, 0.24],
       [0.53, 0.16], [0.50, -0.04], [0.38, -0.19], [0.14, -0.22], [0, -0.14],
       [-0.14, -0.22], [-0.38, -0.19], [-0.50, -0.04]],
      catLens(-0.28, -1), catLens(0.28, 1),
      { dimensions: { aspect: 2.7 } }),
  },
];
