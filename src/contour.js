// Turn a binary SAM mask into clean polygons: the frame's outer outline and the
// lens openings inside it. Pure — no DOM — so it runs under node for tests.
//
// A mask is a Uint8Array of length w*h, 1 = frame material, 0 = background.

/* ---------- cleanup ---------- */

/**
 * Drop small stray blobs but keep any blob at least `minRatio` of the largest — a
 * pair of glasses is sometimes two comparable blobs (left / right lens) when SAM
 * doesn't bridge them, and keeping only a single winner would throw one lens away.
 * (from the MoooFont glasses-fitting branch.)
 */
export function largestComponent(mask, w, h, minRatio = 0.15) {
  const label = new Int32Array(mask.length).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(start); label[start] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && label[p - w] === -1) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && label[p + w] === -1) { label[p + w] = id; stack.push(p + w); }
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return mask.slice();
  const cutoff = Math.max(...sizes) * minRatio;
  const keep = sizes.map(s => s >= cutoff);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (label[i] !== -1 && keep[label[i]]) out[i] = 1;
  return out;
}

/**
 * If the mask is two side-by-side blobs (left lens, right lens) that SAM / the
 * background key didn't bridge, join them with a bar across their overlapping rows
 * so the frame traces as one contour. Up to `maxBlobs` components; no-op otherwise.
 */
export function connectComponents(mask, w, h, maxBlobs = 3) {
  const label = new Int32Array(mask.length).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const id = comps.length; let area = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(); area++;
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && label[p - w] === -1) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && label[p + w] === -1) { label[p + w] = id; stack.push(p + w); }
    }
    comps.push({ id, area, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  if (comps.length < 2 || comps.length > maxBlobs) return mask.slice();
  comps.sort((a, b) => a.cx - b.cx);
  const out = mask.slice();
  for (let i = 0; i < comps.length - 1; i++) {
    const a = comps[i], b = comps[i + 1];
    if (a.area < comps[0].area * 0.1 || b.area < comps[0].area * 0.1) continue;
    const yy0 = Math.max(a.y0, b.y0), yy1 = Math.min(a.y1, b.y1);
    if (yy1 <= yy0) continue;                       // not vertically overlapping — not a lens pair
    const midY = ((yy0 + yy1) / 2) | 0, band = Math.max(2, ((yy1 - yy0) * 0.18) | 0);
    for (let y = Math.max(0, midY - band); y <= Math.min(h - 1, midY + band); y++)
      for (let x = Math.max(0, a.cx | 0); x <= Math.min(w - 1, b.cx | 0); x++)
        out[y * w + x] = 1;
  }
  return out;
}

/**
 * Fill background pockets fully enclosed by the mask — SAM often masks only the rim,
 * leaving a transparent lens as an unmasked hole. Flood-fills real background in from
 * the image border; any 0-pixel that flood never reaches was enclosed → becomes 1.
 * (from the MoooFont glasses-fitting branch.)
 */
export function fillHoles(mask, w, h) {
  const reached = new Uint8Array(mask.length);
  const stack = [];
  const seed = p => { if (!mask[p] && !reached[p]) { reached[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] || !reached[i] ? 1 : 0;
  return out;
}

/** Dilate then erode (r px each) — closes pinholes and gaps in a thin rim. */
export function morphClose(mask, w, h, r = 1) {
  return erode(dilate(mask, w, h, r), w, h, r);
}
/** Erode then dilate — shaves stray hairs / thin bridges to the background. */
export function morphOpen(mask, w, h, r = 1) {
  return dilate(erode(mask, w, h, r), w, h, r);
}

function dilate(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = 0;
    for (let dy = -r; dy <= r && !on; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) { on = 1; break; }
    }
    out[y * w + x] = on;
  }
  return out;
}
function erode(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let all = 1;
    for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) { all = 0; break; }
    }
    out[y * w + x] = all;
  }
  return out;
}

/* ---------- holes ---------- */

/**
 * Background regions that the mask fully encloses = lens openings (and other gaps).
 * Returns [{ mask:Uint8Array, area, cx, cy, bbox }] sorted largest first.
 */
export function detectHoles(mask, w, h) {
  const outside = new Uint8Array(mask.length);   // background reachable from the border
  const stack = [];
  for (let x = 0; x < w; x++) { pushBg(x, 0); pushBg(x, h - 1); }
  for (let y = 0; y < h; y++) { pushBg(0, y); pushBg(w - 1, y); }
  function pushBg(x, y) {
    const p = y * w + x;
    if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); }
  }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p - x) / w;
    if (x > 0) pushBg(x - 1, y);
    if (x < w - 1) pushBg(x + 1, y);
    if (y > 0) pushBg(x, y - 1);
    if (y < h - 1) pushBg(x, y + 1);
  }

  const seen = new Uint8Array(mask.length);
  const holes = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || outside[i] || seen[i]) continue;
    const cells = [];
    const s = [i]; seen[i] = 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0;
    while (s.length) {
      const p = s.pop(); cells.push(p);
      const x = p % w, y = (p - x) / w;
      sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (const q of nb) if (q >= 0 && q < mask.length && !mask[q] && !outside[q] && !seen[q]) { seen[q] = 1; s.push(q); }
    }
    const hm = new Uint8Array(mask.length);
    for (const p of cells) hm[p] = 1;
    holes.push({ mask: hm, area: cells.length, cx: sx / cells.length, cy: sy / cells.length,
                 bbox: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return holes.sort((a, b) => b.area - a.area);
}

/* ---------- contour tracing ---------- */

/**
 * Moore-neighbour boundary trace of the blob in `mask` (1 = inside). Returns an
 * ordered ring of [x, y] pixel coords, clockwise, starting at the top-left-most cell.
 */
export function traceContour(mask, w, h) {
  let start = -1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return [];

  const S = { x: start % w, y: (start - (start % w)) / w };
  const at = (x, y) => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x];
  // 8-neighbour offsets, clockwise from east
  const N = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  const ring = [[S.x, S.y]];
  let cx = S.x, cy = S.y, dir = 6;         // came-from direction ~ north
  const maxSteps = 4 * (w + h) * 8;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 1 + k) % 8;
      const nx = cx + N[d][0], ny = cy + N[d][1];
      if (at(nx, ny)) {
        cx = nx; cy = ny; dir = (d + 4) % 8;   // face back the way we came
        ring.push([cx, cy]);
        found = true;
        break;
      }
    }
    if (!found) break;                          // isolated pixel
    if (cx === S.x && cy === S.y && ring.length > 2) { ring.pop(); break; }
  }
  return ring;
}

/* ---------- simplification ---------- */

/** Douglas–Peucker on a closed ring. `eps` in pixels. */
export function simplify(ring, eps = 2) {
  if (ring.length < 4) return ring.slice();
  // split the closed ring at the two farthest-apart points, simplify each open arc
  let a = 0, b = 0, best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = dist2(ring[0], ring[i]);
    if (d > best) { best = d; b = i; }
  }
  const arc1 = dp(ring.slice(a, b + 1), eps);
  const arc2 = dp(ring.slice(b).concat([ring[0]]), eps);
  return arc1.slice(0, -1).concat(arc2.slice(0, -1));
}

function dp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let idx = 0, max = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - x1) * dy - (pts[i][1] - y1) * dx) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(dp(pts.slice(idx), eps));
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/* ---------- geometry helpers ---------- */

export function polyBBox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Map a pixel polygon into normalised model space: origin at `center`, y-up, unit = `scale`. */
export function normalisePoly(poly, center, scale) {
  return poly.map(([x, y]) => [(x - center.x) / scale, -(y - center.y) / scale]);
}

/**
 * Chaikin corner cutting on a closed ring — turns the staircase left by a pixel
 * mask into a smooth curve. Each pass doubles the point count, so simplify first.
 */
export function smoothRing(ring, passes = 2) {
  let r = ring;
  for (let p = 0; p < passes; p++) {
    if (r.length < 4) return r;
    const out = new Array(r.length * 2);
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length];
      out[i * 2] = [ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25];
      out[i * 2 + 1] = [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75];
    }
    r = out;
  }
  return r;
}
