// Build a GlassesAsset from a SAM mask + the source photo.
//
// The asset keeps the uploaded frame's ACTUAL outline — traced from the mask, not
// picked from round/square/cat-eye. Lens openings are found by classifying the mask
// interior as frame-vs-see-through (works whether SAM returned a solid blob or a
// hollow rim); a landmark ellipse is the last-resort fallback. Either way the outer
// contour is the real one.
//
// Pure. imageData = { data:Uint8ClampedArray, width, height } at the mask's w*h.
// Model space: x right, y up, origin between the lenses, frame width ≈ 1.0.

import {
  largestComponent, connectComponents, fillHoles, morphClose, morphOpen, detectHoles,
  traceContour, simplify, polyBBox, polyArea, normalisePoly,
} from './contour.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const luma = c => (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hexOf = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const medianColor = cs => cs.length ? hexOf([0, 1, 2].map(k => median(cs.map(c => c[k])))) : '#3a3a3a';

function ellipsePoly(cx, cy, rx, ry, n = 28) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return p;
}

/**
 * Cut the actual frame pixels out of the source: the region inside the traced outline
 * and OUTSIDE the lens openings, everything else transparent. This is the texture that
 * gets mapped onto the 3D model, so the real material / colour / print is preserved —
 * it is not pasted flat, it rides on the extruded geometry.
 * Browser only (needs a canvas); returns a PNG data URL, or null under node.
 */
function buildFrontTexture(srcCanvas, ob, outlinePx, lensLpx, lensRpx) {
  if (typeof document === 'undefined') return null;
  const cap = 512;
  const k = Math.min(1, cap / ob.w);
  const tw = Math.max(8, Math.round(ob.w * k)), th = Math.max(8, Math.round(ob.h * k));
  const c = document.createElement('canvas'); c.width = tw; c.height = th;
  const cx = c.getContext('2d');
  cx.drawImage(srcCanvas, ob.x0, ob.y0, ob.w, ob.h, 0, 0, tw, th);

  const trace = (ctx, poly) => {
    poly.forEach(([x, y], i) => {
      const px = (x - ob.x0) * k, py = (y - ob.y0) * k;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
  };
  // frame mask = outline minus the two lens holes
  const mc = document.createElement('canvas'); mc.width = tw; mc.height = th;
  const mx = mc.getContext('2d');
  mx.fillStyle = '#fff';
  mx.beginPath(); trace(mx, outlinePx); trace(mx, lensLpx); trace(mx, lensRpx);
  mx.fill('evenodd');

  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(mc, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Foreground mask for a product shot on a plain background — no SAM, no face needed.
 * Corner-samples the background colour and keys it out; then the glasses (frame AND
 * green/tinted lenses, which differ from the wall) is the foreground.
 * Returns { mask, bg:[r,g,b], plainBg:boolean, spread:number }.
 */
export function foregroundFromBackground(img, w, h) {
  const s = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const patch = (x0, y0) => {
    const cs = [];
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) cs.push(px(img, clamp(x, 0, w - 1), clamp(y, 0, h - 1)));
    return [0, 1, 2].map(k => median(cs.map(c => c[k])));
  };
  const corners = [patch(0, 0), patch(w - s, 0), patch(0, h - s), patch(w - s, h - s)];
  const bg = [0, 1, 2].map(k => median(corners.map(c => c[k])));
  const spread = Math.max(...corners.map(c => Math.sqrt(dist2(c, bg))));
  const plainBg = spread < 34;

  // adaptive tolerance: a touch above the corner spread, floor 34
  const tol2 = Math.max(34, spread * 1.6) ** 2;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (dist2(px(img, x, y), bg) > tol2) m[y * w + x] = 1;
  }
  return { mask: m, bg, plainBg, spread: +spread.toFixed(1) };
}

/** Zero the mask outside a band around the eyes, so hair / forehead / chin can't leak in. */
function bandCrop(mask, w, h, lm) {
  if (!lm || !lm[33] || !lm[263]) return mask.slice();
  const eL = lm[33], eR = lm[263];
  const span = Math.hypot((eR.x - eL.x) * w, (eR.y - eL.y) * h);
  const midX = ((eL.x + eR.x) / 2) * w, midY = ((eL.y + eR.y) / 2) * h;
  const x0 = midX - span * 1.15, x1 = midX + span * 1.15;
  const y0 = midY - span * 0.72, y1 = midY + span * 0.60;
  const out = new Uint8Array(mask.length);
  for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1 | 0); y++)
    for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1 | 0); x++)
      out[y * w + x] = mask[y * w + x];
  return out;
}

/** Erode by r, return the shell (mask minus eroded) — pixels near the outer boundary. */
function boundaryShell(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    let edge = false;
    for (let d = 1; d <= r && !edge; d++) {
      if (x - d < 0 || x + d >= w || y - d < 0 || y + d >= h) { edge = true; break; }
      if (!mask[y * w + (x - d)] || !mask[y * w + (x + d)] || !mask[(y - d) * w + x] || !mask[(y + d) * w + x]) edge = true;
    }
    if (edge) out[y * w + x] = 1;
  }
  return out;
}

/**
 * Lens openings by colour: mask pixels far from the frame colour (and not too dark)
 * form the see-through regions. Returns up to 2 hole descriptors, else [].
 */
function colourHoles(mask, img, w, h, frameRGB, ob) {
  const open = new Uint8Array(mask.length);
  const thr2 = 56 * 56;
  for (let y = ob.y0; y <= ob.y1; y++) for (let x = ob.x0; x <= ob.x1; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    if (dist2(px(img, x, y), frameRGB) > thr2) open[i] = 1;   // clearly not frame material
  }
  const opened = morphClose(morphOpen(open, w, h, 1), w, h, 1);
  // connected components of `opened`, keep the big central ones
  const seen = new Uint8Array(mask.length), comps = [];
  for (let i = 0; i < opened.length; i++) {
    if (!opened[i] || seen[i]) continue;
    const s = [i]; seen[i] = 1; const cells = [];
    let sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (s.length) {
      const p = s.pop(); cells.push(p);
      const x = p % w, y = (p - x) / w; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w])
        if (q >= 0 && q < opened.length && opened[q] && !seen[q]) { seen[q] = 1; s.push(q); }
    }
    const hm = new Uint8Array(mask.length);
    for (const p of cells) hm[p] = 1;
    comps.push({ mask: hm, area: cells.length, cx: sx / cells.length, cy: sy / cells.length,
                 bbox: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return comps
    .filter(c => c.area > (ob.w * ob.h) * 0.02 && c.bbox.h > ob.h * 0.25 && Math.abs(c.cy - ob.cy) < ob.h * 0.5)
    .sort((a, b) => b.area - a.area).slice(0, 4);
}

export function buildAsset(img, mask, w, h, landmarks) {
  const stages = {};
  // a drawable copy of the source, for the front texture
  let srcCanvas = null;
  if (typeof document !== 'undefined') {
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = w; srcCanvas.height = h;
    srcCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), w, h), 0, 0);
  }
  const fail = reason => ({
    ok: false, reason,
    geometry: fallbackGeometry(),
    dimensions: { aspect: 2.6, rimRatio: 0.09, templeLen: 1.35, templeDrop: 0.12, depth: 0.06 },
    frameColor: '#3a3a3a', lensColor: '#ffffff', lensOpacity: 0.10,
    placement: { spanRatio: 1.55, yRatio: -0.05 },
    quality: { hasHoles: false, contourPoints: 0, score: 0 },
    stages,
  });

  // 1. clean + band-crop. keep comparable blobs (both lenses), smooth, then a
  //    hole-filled copy for a clean OUTER contour — holes are found from `m` below.
  let m = bandCrop(mask, w, h, landmarks);
  m = largestComponent(m, w, h, 0.15);
  m = morphClose(m, w, h, 1);
  m = morphOpen(m, w, h, 1);
  const joined = connectComponents(m, w, h);        // bridge a left/right lens pair
  const solid = fillHoles(joined, w, h);
  stages.cleanMask = m;
  stages.solidMask = solid;

  // 2. outer contour (from the solid mask). The traced outline is ALWAYS kept —
  //    an unusual frame must not be replaced by a generic ellipse. `ok` below is a
  //    confidence flag, not a gate on the geometry.
  const rawRing = traceContour(solid, w, h);
  if (rawRing.length < 12) return fail('no contour');
  const ringEps = Math.max(1.5, (w + h) / 400);
  const outlinePx = simplify(rawRing, ringEps);
  const ob = polyBBox(outlinePx);
  stages.outlinePx = outlinePx;

  const areaFrac = polyArea(outlinePx) / (w * h);
  const aspect = ob.w / Math.max(1, ob.h);
  if (areaFrac < 0.0015 || areaFrac > 0.9) return fail('contour fills the frame or is a speck');
  const shapeLooksRight = aspect > 1.15 && aspect < 6.5 && ob.h > h * 0.03;

  // 3. frame colour from the boundary shell (definitely frame material)
  const rimGuess = Math.max(2, Math.round(Math.min(ob.w, ob.h) * 0.06));
  const shell = boundaryShell(m, w, h, rimGuess);
  const shellCols = [];
  for (let y = ob.y0; y <= ob.y1; y++) for (let x = ob.x0; x <= ob.x1; x++)
    if (shell[y * w + x] && (y - ob.cy) > -ob.h * 0.15) shellCols.push(px(img, x, y));  // lower + sides
  let pool = shellCols;
  const byL = [...shellCols].sort((p, q) => luma(p) - luma(q));
  if (byL.length && luma(byL[byL.length >> 1]) > 55) pool = byL.slice(Math.floor(byL.length * 0.2));
  const frameColor = medianColor(pool.length ? pool : shellCols);
  const frameRGB = [parseInt(frameColor.slice(1, 3), 16), parseInt(frameColor.slice(3, 5), 16), parseInt(frameColor.slice(5, 7), 16)];

  // 4. lens openings — topological holes (rim-only mask), then a colour split of the
  //    solid mask (SAM blob OR background-keyed foreground), then an ellipse fallback.
  const holeOk = hh => {
    const f = hh.area / polyArea(outlinePx);
    return f > 0.025 && f < 0.6 && hh.bbox.w > ob.w * 0.1 && hh.bbox.h > ob.h * 0.18 && Math.abs(hh.cy - ob.cy) < ob.h * 0.55;
  };
  let holes = detectHoles(joined, w, h).filter(holeOk);
  let hasHoles = holes.length >= 2;
  if (!hasHoles) {
    const ch = colourHoles(joined, img, w, h, frameRGB, ob).filter(holeOk);
    if (ch.length >= 2) { holes = ch; hasHoles = true; }
  }

  let lensLpx, lensRpx;
  if (hasHoles) {
    const L = holes.filter(hh => hh.cx < ob.cx).sort((a, b) => b.area - a.area)[0];
    const R = holes.filter(hh => hh.cx > ob.cx).sort((a, b) => b.area - a.area)[0];
    if (L && R) {
      lensLpx = simplify(traceContour(L.mask, w, h), ringEps);
      lensRpx = simplify(traceContour(R.mask, w, h), ringEps);
    } else hasHoles = false;
  }
  if (!lensLpx) {
    const eyeXs = landmarks
      ? [landmarks[468] || landmarks[159], landmarks[473] || landmarks[386]].map(p => p && p.x * w)
      : [];
    const cxL = eyeXs[0] || ob.x0 + ob.w * 0.28;
    const cxR = eyeXs[1] || ob.x0 + ob.w * 0.72;
    const rx = ob.w * 0.19, ry = ob.h * 0.33, cy = ob.cy + ob.h * 0.03;
    lensLpx = ellipsePoly(cxL, cy, rx, ry);
    lensRpx = ellipsePoly(cxR, cy, rx, ry);
  }
  stages.lensLpx = lensLpx; stages.lensRpx = lensRpx;

  // 5. normalise into model space
  const lb = polyBBox(lensLpx), rb = polyBBox(lensRpx);
  const centre = { x: (lb.cx + rb.cx) / 2, y: (lb.cy + rb.cy) / 2 };
  const scale = ob.w;
  const outline = normalisePoly(outlinePx, centre, scale);
  const lensL = normalisePoly(lensLpx, centre, scale);
  const lensR = normalisePoly(lensRpx, centre, scale);

  // the real frame pixels, cut to the frame shape, + where they sit in model space
  const frontTexture = buildFrontTexture(srcCanvas, ob, outlinePx, lensLpx, lensRpx);
  const textureBox = {
    x0: (ob.x0 - centre.x) / scale, y0: -(ob.y1 - centre.y) / scale,
    w: ob.w / scale, h: ob.h / scale,
  };

  const near = outline.filter(([, y]) => Math.abs(y) < 0.14);
  const hpool = near.length >= 2 ? near : outline;
  const hingeL = hpool.reduce((a, b) => (b[0] < a[0] ? b : a));
  const hingeR = hpool.reduce((a, b) => (b[0] > a[0] ? b : a));

  const lInner = Math.max(...lensL.map(p => p[0]));
  const rInner = Math.min(...lensR.map(p => p[0]));
  const bYs = [...lensL, ...lensR].filter(p => p[0] > lInner - 0.05 && p[0] < rInner + 0.05).map(p => p[1]);
  const bridge = { x: (lInner + rInner) / 2, yTop: bYs.length ? Math.max(...bYs) : 0.1, width: Math.max(0.04, rInner - lInner) };

  // 6. dimensions
  const lensWpx = (lb.w + rb.w) / 2;
  const rimRatio = measureRim(outlinePx, lensLpx.concat(lensRpx), lensWpx);
  const dimensions = {
    aspect: +(ob.w / Math.max(1, ob.h)).toFixed(3),
    rimRatio: +rimRatio.toFixed(3),
    templeLen: 1.35, templeDrop: 0.12,
    depth: +clamp(0.04 + rimRatio * 0.4, 0.03, 0.14).toFixed(3),
  };

  // 7. lens tint — median colour over each hole interior (not one pixel), then decide
  //    clear vs tinted vs dark from luma + chroma.
  const sampleHole = poly => {
    const bb = polyBBox(poly), cs = [];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      const sx = clamp(Math.round(bb.x0 + bb.w * (0.3 + 0.4 * (k % 7) / 6)), 0, w - 1);
      const sy = clamp(Math.round(bb.y0 + bb.h * (0.3 + 0.4 * t)), 0, h - 1);
      cs.push(px(img, sx, sy));
    }
    return [0, 1, 2].map(ch => median(cs.map(c => c[ch])));
  };
  const lc = sampleHole(lensLpx), rc = sampleHole(lensRpx);
  const avg = [0, 1, 2].map(k => (lc[k] + rc[k]) / 2);
  const lensLum = luma(avg);
  const chroma = Math.max(...avg) - Math.min(...avg);
  const warmSkin = avg[0] === Math.max(...avg) && avg[0] - avg[2] > 38;   // eye/skin behind a clear lens
  let lensColor, lensOpacity;
  if (lensLum < 90) { lensColor = hexOf(avg); lensOpacity = +clamp((150 - lensLum) / 260, 0.18, 0.62).toFixed(2); }
  else if (chroma > 20 && !warmSkin) { lensColor = hexOf(avg); lensOpacity = +clamp(chroma / 130, 0.12, 0.42).toFixed(2); }
  else { lensColor = '#ffffff'; lensOpacity = 0.05; }

  // 8. placement on the source face
  let spanRatio = 1.55, yRatio = -0.05;
  if (landmarks && landmarks[33] && landmarks[263]) {
    const eyeSpan = Math.hypot((landmarks[263].x - landmarks[33].x) * w, (landmarks[263].y - landmarks[33].y) * h);
    const eyeMidY = ((landmarks[33].y + landmarks[263].y) / 2) * h;
    if (eyeSpan > 1) {
      spanRatio = +clamp(ob.w / eyeSpan, 1.15, 2.2).toFixed(3);
      yRatio = +clamp((ob.cy - eyeMidY) / eyeSpan, -0.3, 0.15).toFixed(3);
    }
  }

  const score = clamp((hasHoles ? 0.5 : 0.25) + (shapeLooksRight ? 0.35 : 0)
    + 0.15 * (1 - Math.abs(dimensions.aspect - 2.6) / 3), 0.1, 1);

  return {
    // geometry is always the real trace; `ok` just says "confident enough not to nag"
    ok: hasHoles && shapeLooksRight,
    lowConfidence: !(hasHoles && shapeLooksRight),
    geometry: { outline, lensL, lensR, bridge, hingeL, hingeR },
    frontTexture, textureBox,          // the real frame pixels, mapped onto the model
    dimensions, frameColor, lensColor, lensOpacity,
    placement: { spanRatio, yRatio },
    quality: {
      hasHoles, shapeLooksRight, contourPoints: outline.length,
      lensPoints: lensL.length + lensR.length, maskAreaFrac: +areaFrac.toFixed(4),
      score: +score.toFixed(2),
    },
    stages,
  };
}

function measureRim(outline, lens, lensWidth) {
  if (!lens.length || !lensWidth) return 0.09;
  const step = Math.max(1, Math.floor(outline.length / 24));
  const ds = [];
  for (let i = 0; i < outline.length; i += step) {
    const [ox, oy] = outline[i];
    let best = Infinity;
    for (const [lx, ly] of lens) { const d = Math.hypot(ox - lx, oy - ly); if (d < best) best = d; }
    ds.push(best);
  }
  return clamp(median(ds) / lensWidth, 0.03, 0.28);
}

function fallbackGeometry() {
  const lens = cx => {
    const p = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; p.push([cx + Math.cos(a) * 0.22, Math.sin(a) * 0.19]); }
    return p;
  };
  const outline = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; outline.push([Math.cos(a) * 0.54, Math.sin(a) * 0.22]); }
  return { outline, lensL: lens(-0.28), lensR: lens(0.28),
           bridge: { x: 0, yTop: 0.12, width: 0.12 }, hingeL: [-0.54, 0], hingeR: [0.54, 0] };
}
