import assert from 'node:assert/strict';
import {
  largestComponent, connectComponents, fillHoles, morphClose, morphOpen, detectHoles,
  traceContour, simplify, polyBBox, polyArea, normalisePoly,
} from './src/contour.js';

// helpers to build masks
const grid = (w, h, fn) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = fn(x, y) ? 1 : 0; return m; };

/* largestComponent: a 6x6 block + a lone pixel -> block survives, speck dropped */
{
  const w = 20, h = 20;
  const m = grid(w, h, (x, y) => (x >= 3 && x < 9 && y >= 3 && y < 9) || (x === 15 && y === 15));
  const big = largestComponent(m, w, h);
  assert.equal(big[5 * w + 5], 1, 'block kept');
  assert.equal(big[15 * w + 15], 0, 'lone pixel dropped');
  let n = 0; for (const v of big) n += v;
  assert.equal(n, 36);
}

/* largestComponent keeps a comparably-sized second blob (the other lens) */
{
  const w = 24, h = 10, m = new Uint8Array(w * h);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m[y * w + x] = 1;
  for (let y = 1; y <= 3; y++) for (let x = 18; x <= 20; x++) m[y * w + x] = 1;
  m[7 * w + 12] = 1;   // speck
  const kept = largestComponent(m, w, h, 0.15);
  assert.equal(kept[2 * w + 2], 1);
  assert.equal(kept[2 * w + 19], 1, 'second lens kept');
  assert.equal(kept[7 * w + 12], 0, 'speck dropped');
}

/* connectComponents: two side-by-side lens blobs with a gap -> joined into one contour */
{
  const w = 60, h = 20, m = new Uint8Array(w * h);
  for (let y = 5; y <= 14; y++) for (let x = 6; x <= 20; x++) m[y * w + x] = 1;   // left lens
  for (let y = 5; y <= 14; y++) for (let x = 38; x <= 52; x++) m[y * w + x] = 1;  // right lens (gap 21..37)
  const joined = connectComponents(m, w, h);
  assert.equal(joined[10 * w + 29], 1, 'gap between the lenses is bridged');
  const comps = () => {
    const seen = new Uint8Array(w * h); let n = 0;
    for (let i = 0; i < joined.length; i++) {
      if (!joined[i] || seen[i]) continue;
      n++; const s = [i]; seen[i] = 1;
      while (s.length) { const p = s.pop(); for (const q of [p - 1, p + 1, p - w, p + w])
        if (q >= 0 && q < joined.length && joined[q] && !seen[q]) { seen[q] = 1; s.push(q); } }
    }
    return n;
  };
  assert.equal(comps(), 1, 'now a single component');
  // vertically stacked blobs (not a lens pair) are left alone
  const v = new Uint8Array(w * h);
  for (let y = 1; y <= 4; y++) for (let x = 10; x <= 14; x++) v[y * w + x] = 1;
  for (let y = 14; y <= 18; y++) for (let x = 10; x <= 14; x++) v[y * w + x] = 1;
  assert.equal(connectComponents(v, w, h)[9 * w + 12], 0, 'vertical pair not bridged');
}

/* fillHoles: a hollow ring -> interior filled, outside untouched */
{
  const w = 12, h = 12, m = new Uint8Array(w * h);
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++)
    if (x === 3 || x === 8 || y === 3 || y === 8) m[y * w + x] = 1;
  const f = fillHoles(m, w, h);
  assert.equal(f[5 * w + 5], 1, 'enclosed hole filled');
  assert.equal(f[0], 0, 'outside untouched');
}

/* morphClose fills a single-pixel hole; morphOpen removes a 1px spur */
{
  const w = 12, h = 12;
  const m = grid(w, h, (x, y) => x >= 2 && x < 10 && y >= 2 && y < 10);
  m[5 * w + 5] = 0;                         // poke a hole
  const closed = morphClose(m, w, h, 1);
  assert.equal(closed[5 * w + 5], 1, 'hole filled');

  const spur = grid(w, h, (x, y) => (x >= 2 && x < 8 && y >= 2 && y < 8));
  spur[4 * w + 9] = 1;                      // detached-ish spur pixel
  const opened = morphOpen(spur, w, h, 1);
  assert.equal(opened[4 * w + 9], 0, 'spur removed');
}

/* detectHoles: a square ring (thick border, empty middle) -> exactly one hole */
{
  const w = 30, h = 30;
  const outer = (x, y) => x >= 4 && x < 26 && y >= 4 && y < 26;
  const inner = (x, y) => x >= 9 && x < 21 && y >= 9 && y < 21;
  const m = grid(w, h, (x, y) => outer(x, y) && !inner(x, y));
  const holes = detectHoles(m, w, h);
  assert.equal(holes.length, 1, 'one enclosed hole');
  assert.ok(holes[0].area >= 100 && holes[0].area <= 200);
  assert.ok(Math.abs(holes[0].cx - 15) < 1 && Math.abs(holes[0].cy - 15) < 1);
}

/* glasses-like: two lens rings joined by a bridge -> 2 holes, wide bbox */
{
  const w = 120, h = 50;
  const ring = (cx) => (x, y) => {
    const o = ((x - cx) / 22) ** 2 + ((y - 25) / 18) ** 2;
    return o <= 1 && o >= 0.55;
  };
  const bridge = (x, y) => x >= 55 && x < 65 && y >= 18 && y < 24;
  const m = grid(w, h, (x, y) => ring(35)(x, y) || ring(85)(x, y) || bridge(x, y));
  const clean = largestComponent(morphClose(m, w, h, 1), w, h);
  const holes = detectHoles(clean, w, h);
  assert.ok(holes.length >= 2, 'two lens openings, got ' + holes.length);
  const [a, b] = holes.slice(0, 2).sort((p, q) => p.cx - q.cx);
  assert.ok(a.cx < 55 && b.cx > 55, 'one hole each side of the bridge');

  const outline = simplify(traceContour(clean, w, h), 2);
  const bb = polyBBox(outline);
  assert.ok(bb.w / bb.h > 1.6, 'outline is wide like glasses');
  assert.ok(outline.length >= 8 && outline.length < 200, 'outline simplified: ' + outline.length);
}

/* traceContour + simplify: a plain rectangle -> ~4 corners */
{
  const w = 40, h = 30;
  const m = grid(w, h, (x, y) => x >= 6 && x < 34 && y >= 5 && y < 25);
  const poly = simplify(traceContour(m, w, h), 1.5);
  assert.ok(poly.length >= 4 && poly.length <= 8, 'rectangle ~4 pts, got ' + poly.length);
  assert.ok(Math.abs(polyArea(poly) - 28 * 20) / (28 * 20) < 0.15, 'area within 15%');
}

/* normalisePoly: centre -> origin, y flips */
{
  const p = normalisePoly([[10, 10], [20, 10], [20, 20]], { x: 15, y: 15 }, 10);
  assert.deepEqual(p[0], [-0.5, 0.5]);
  assert.deepEqual(p[1], [0.5, 0.5]);
  assert.deepEqual(p[2], [0.5, -0.5]);
}

console.log('ok');

// smoothRing: a square's corners get cut, the ring stays closed and inside the hull
{
  const { smoothRing } = await import('./src/contour.js');
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const s = smoothRing(sq, 2);
  assert.equal(s.length, 16, 'two passes quadruple the points');
  assert.ok(s.every(([x, y]) => x >= -0.01 && x <= 10.01 && y >= -0.01 && y <= 10.01), 'stays in the hull');
  const corner = s.some(([x, y]) => x < 0.6 && y < 0.6);
  assert.ok(!corner, 'the sharp corner is cut away');
}
console.log('ok');
