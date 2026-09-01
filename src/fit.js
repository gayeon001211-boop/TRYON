// Analysis-by-synthesis: draw the frame we built, compare it with the frame we saw,
// and nudge the measurements until they agree.
//
// Until now the pipeline was one-way — mask → outline → measure → build — so a
// measurement could be wrong with nothing to catch it (the uploaded frame's outer
// wings went missing and every number still looked fine). This closes the loop and
// gives one honest number for it: IoU against the observed mask.
//
// Pure: no DOM, no three.js. See test_fit.mjs.

import { radialProfile } from './eyewear.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Free parameters of the fit. All are multipliers/offsets on the measured spec. */
export const IDENTITY = {
  sx: 1, sy: 1, gap: 1, rim: 1, epW: 1, epH: 1, epY: 0, bridgeY: 0, rot: 0, tx: 0, ty: 0,
};

const rimAt = (spec, i) => (spec.rimProfile ? spec.rimProfile[i] : spec.rimW);

function ring(spec, p, grow) {
  const n = spec.n, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    const r = spec.lensR[i] + (grow ? rimAt(spec, i) * p.rim : 0);
    out[i] = [Math.cos(a) * r * p.sx, Math.sin(a) * r * p.sy];
  }
  return out;
}

/** Place a lens-local polygon on one side of the frame, with the fit's pose applied. */
function place(poly, spec, p, sign) {
  const cx = sign * spec.halfGap * p.gap + p.tx;
  const cy = spec.centreY + p.ty;
  const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
  return poly.map(([x, y]) => {
    const px = x + cx, py = y + cy;
    return [px * ca - py * sa, px * sa + py * ca];
  });
}

function rect(cx, cy, w, h, p) {
  const hw = w / 2, hh = h / 2;
  const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
    const px = x + cx + p.tx, py = y + cy + p.ty;
    return [px * ca - py * sa, px * sa + py * ca];
  });
}

/** Scanline fill of a simple polygon, in model space, through `tf`. */
export function fillPoly(mask, w, h, poly, tf, value = 1) {
  const pts = poly.map(([x, y]) => [tf.cx + x * tf.scale, tf.cy - y * tf.scale]);
  let y0 = Infinity, y1 = -Infinity;
  for (const [, py] of pts) { if (py < y0) y0 = py; if (py > y1) y1 = py; }
  const yStart = Math.max(0, Math.ceil(y0)), yEnd = Math.min(h - 1, Math.floor(y1));
  const xs = [];
  for (let y = yStart; y <= yEnd; y++) {
    xs.length = 0;
    const cy = y + 0.5;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k])), to = Math.min(w - 1, Math.floor(xs[k + 1]));
      for (let x = from; x <= to; x++) mask[y * w + x] = value;
    }
  }
  return mask;
}

/**
 * The frame's front silhouette as a mask: two rims, the end pieces, the bridge,
 * minus the two lens openings. `tf` maps model space to pixels: px = cx + x*scale,
 * py = cy - y*scale.
 */
export function rasterSpec(spec, p, tf, w, h) {
  const mask = new Uint8Array(w * h);
  const e = spec.endPiece;
  for (const sign of [-1, 1]) {
    fillPoly(mask, w, h, place(ring(spec, p, true), spec, p, sign), tf, 1);
    if (e) {
      fillPoly(mask, w, h,
        rect(sign * e.x, e.y + p.epY, e.w * p.epW, e.h * p.epH, p), tf, 1);
    }
  }
  const b = spec.bridge;
  if (b && b.needed) {
    fillPoly(mask, w, h,
      rect(0, b.y + p.bridgeY + b.arch * 0.5, b.span + spec.rimW, b.thick, p), tf, 1);
  }
  for (const sign of [-1, 1]) {
    fillPoly(mask, w, h, place(ring(spec, p, false), spec, p, sign), tf, 0);
  }
  return mask;
}

/** Intersection over union of two 0/1 masks. */
export function iou(a, b) {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union ? inter / union : 0;
}

/** Box-downsample a 0/1 mask so the search runs on ~256px, whatever the source size. */
export function shrink(mask, w, h, maxSide = 256) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  if (k >= 1) return { mask, width: w, height: h, scale: 1 };
  const nw = Math.max(8, Math.round(w * k)), nh = Math.max(8, Math.round(h * k));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    out[y * nw + x] = mask[Math.min(h - 1, (y / k) | 0) * w + Math.min(w - 1, (x / k) | 0)];
  }
  return { mask: out, width: nw, height: nh, scale: k };
}

// how far each parameter may stray from the measurement, and the first step size
const RANGE = {
  sx: [0.7, 1.3, 0.06], sy: [0.7, 1.3, 0.06], gap: [0.8, 1.25, 0.05],
  rim: [0.6, 1.6, 0.08], epW: [0.5, 1.8, 0.1], epH: [0.5, 1.8, 0.1],
  epY: [-0.06, 0.06, 0.012], bridgeY: [-0.06, 0.06, 0.012],
  rot: [-0.12, 0.12, 0.02], tx: [-0.06, 0.06, 0.012], ty: [-0.06, 0.06, 0.012],
};

/**
 * Pattern search on IoU. Coordinate descent with step halving — no gradients, no
 * dependencies, and it converges in a few hundred rasterisations (well under a second).
 * The bounds keep this a refinement of the measurement, never a replacement for it.
 */
export function fitSpec(spec, target, w, h, tf, opts = {}) {
  const rounds = opts.rounds ?? 6;
  const keys = Object.keys(RANGE);
  let best = { ...IDENTITY, ...(opts.start || {}) };
  let bestScore = iou(rasterSpec(spec, best, tf, w, h), target);
  const step = {};
  for (const k of keys) step[k] = RANGE[k][2];

  let evals = 1;
  for (let round = 0; round < rounds; round++) {
    let improved = false;
    for (const k of keys) {
      for (const dir of [1, -1]) {
        // walk while it keeps helping: one step per sweep converged far too slowly
        let moved = false;
        for (;;) {
          const cand = { ...best, [k]: clamp(best[k] + dir * step[k], RANGE[k][0], RANGE[k][1]) };
          if (cand[k] === best[k]) break;
          const s = iou(rasterSpec(spec, cand, tf, w, h), target);
          evals++;
          if (s <= bestScore + 1e-5) break;
          best = cand; bestScore = s; improved = moved = true;
        }
        if (moved) break;
      }
    }
    if (!improved) for (const k of keys) step[k] /= 2;
  }
  return { params: best, iou: +bestScore.toFixed(4), evals };
}

/**
 * Bake the SHAPE parameters back into a spec. `tx`/`ty`/`rot` are not shape — they only
 * aligned the model with the photo — so they come back as `placement` for the caller,
 * and the frame itself stays centred and symmetric.
 */
export function applyFit(spec, p) {
  const n = spec.n;
  const lens = [], outer = [];
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n, c = Math.cos(a), s = Math.sin(a);
    const rl = spec.lensR[i], ro = rl + rimAt(spec, i) * p.rim;
    // anisotropic scaling moves a point to a new ANGLE as well as a new radius,
    // so scale the polygon and re-profile it rather than scaling radii in place
    lens.push([c * rl * p.sx, s * rl * p.sy]);
    outer.push([c * ro * p.sx, s * ro * p.sy]);
  }
  const lp = radialProfile(lens, n), op = radialProfile(outer, n);
  const rimProfile = new Float64Array(n);
  for (let i = 0; i < n; i++) rimProfile[i] = Math.max(1e-4, op.r[i] - lp.r[i]);

  let lensW = 0, lensH = 0;
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    lensW = Math.max(lensW, Math.abs(Math.cos(a) * lp.r[i]) * 2);
    lensH = Math.max(lensH, Math.abs(Math.sin(a) * lp.r[i]) * 2);
  }
  const e = spec.endPiece;
  let rimW = 0;
  for (let i = 0; i < n; i++) rimW += rimProfile[i];
  rimW /= n;

  return {
    ...spec, lensR: lp.r, rimProfile, lensW, lensH, rimW,
    halfGap: spec.halfGap * p.gap,
    endPiece: e && { ...e, w: e.w * p.epW, h: e.h * p.epH, y: e.y + p.epY },
    bridge: spec.bridge && { ...spec.bridge, y: spec.bridge.y + p.bridgeY },
    placement: { tx: p.tx, ty: p.ty, rot: p.rot },
    fit: p,
  };
}
