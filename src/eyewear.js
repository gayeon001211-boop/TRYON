// Turn a traced silhouette into a wearable pair of glasses.
//
// The trace tells us the *proportions* of the frame someone uploaded — lens shape,
// how far apart, how thick the rim, how tall. It does not give a shape anyone could
// wear: a pixel mask is asymmetric, jagged, and has no bridge, end pieces or hinges.
// So the trace is treated as a measurement, and a real frame is built to match it.
// Pure functions, no DOM — see test_eyewear.mjs.

const TAU = Math.PI * 2;

export function centroid(poly) {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

/** Radius of a polygon by angle about its centroid, on `n` even steps. Gaps interpolated. */
export function radialProfile(poly, n = 128) {
  const c = centroid(poly);
  const r = new Float64Array(n), seen = new Uint8Array(n);
  for (const [x, y] of poly) {
    const dx = x - c[0], dy = y - c[1];
    const i = ((Math.round(((Math.atan2(dy, dx) + TAU) % TAU) / TAU * n) % n) + n) % n;
    const d = Math.hypot(dx, dy);
    if (d > r[i]) r[i] = d;
    seen[i] = 1;
  }
  for (let i = 0; i < n; i++) {                       // fill angles no vertex landed on
    if (seen[i]) continue;
    let a = i, b = i;
    while (!seen[(a + n) % n]) a--;
    while (!seen[b % n]) b++;
    const t = (i - a) / (b - a);
    r[i] = r[(a + n) % n] * (1 - t) + r[b % n] * t;
  }
  return { c, r };
}

/**
 * Keep the lowest `k` harmonics of a closed radius profile. This is what turns a
 * mask staircase into a curve a designer would draw, while keeping the character of
 * the shape (a cat-eye stays a cat-eye, it just stops being lumpy).
 */
export function lowPass(r, k = 6) {
  const n = r.length, A = [], B = [];
  for (let h = 0; h <= k; h++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const t = TAU * h * i / n; a += r[i] * Math.cos(t); b += r[i] * Math.sin(t); }
    A.push(2 * a / n); B.push(2 * b / n);
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = A[0] / 2;
    for (let h = 1; h <= k; h++) { const t = TAU * h * i / n; v += A[h] * Math.cos(t) + B[h] * Math.sin(t); }
    out[i] = v;
  }
  return out;
}

/** One lens shape for both eyes: mirror the right onto the left, average, then smooth. */
export function canonicalLens(lensL, lensR, n = 128, harmonics = 7) {
  const L = radialProfile(lensL, n), R = radialProfile(lensR, n);
  const merged = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const mirrored = R.r[(n - i) % n];               // reflect about the vertical axis
    merged[i] = (L.r[i] + mirrored) / 2;
  }
  return { r: lowPass(merged, harmonics), cL: L.c, cR: R.c };
}

export function polyFromProfile(r, cx = 0, cy = 0, grow = 0) {
  const n = r.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    out[i] = [cx + Math.cos(a) * (r[i] + grow), cy + Math.sin(a) * (r[i] + grow)];
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Measurements → a buildable frame. Everything is symmetric by construction and in
 * the asset's normalised space (frame ≈ 1 wide, y up, origin between the eyes).
 */
export function eyewearSpec(asset, n = 128) {
  const g = asset.geometry;
  const { r, cL, cR } = canonicalLens(g.lensL, g.lensR, n);
  let lensW = 0, lensH = 0;
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    lensW = Math.max(lensW, Math.abs(Math.cos(a) * r[i]) * 2);
    lensH = Math.max(lensH, Math.abs(Math.sin(a) * r[i]) * 2);
  }
  const halfGap = Math.abs(cR[0] - cL[0]) / 2;
  const centreY = (cL[1] + cR[1]) / 2;

  // a rim thinner than ~5% of the lens is not mouldable, thicker than ~14% is a goggle
  const rimW = clamp((asset.dimensions?.rimRatio ?? 0.09) * lensW, lensW * 0.05, lensW * 0.14);
  // front depth: real acetate is ~4-6 mm on a ~140 mm frame, i.e. 3-4.5% of the width.
  // 9% made every frame look like a swim goggle from the side.
  const depth = clamp(asset.dimensions?.depth ?? 0.045, 0.028, 0.05);

  // the bridge spans the gap between the RIMS, not between the lens centres —
  // measuring from the centres put the bar inside the rims, where it was invisible
  const rimGap = 2 * (halfGap - lensW / 2 - rimW);

  return {
    n, lensR: r, lensW, lensH, halfGap, centreY, rimW, depth, rimGap,
    bridge: {
      y: centreY + lensH * 0.20,
      span: Math.max(0, rimGap),
      // rims that already meet are a one-piece front; a bar there would be buried
      needed: rimGap > lensW * 0.04,
      thick: rimW * 0.9,
      arch: lensH * 0.10,
    },
    endPiece: { x: halfGap + lensW / 2 + rimW * 0.30, y: centreY + lensH * 0.30, size: rimW * 1.1 },
    wrap: 0.13,                                  // radians each lens turns back — real frames are not flat
    templeLen: asset.dimensions?.templeLen ?? 1.05,
    templeDrop: asset.dimensions?.templeDrop ?? 0.12,
  };
}
