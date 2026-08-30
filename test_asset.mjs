import assert from 'node:assert/strict';
import { buildAsset } from './src/glassesAsset.js';
import { polyBBox } from './src/contour.js';

/* Build a synthetic photo + mask of a pair of glasses.
   kind: 'round' | 'rect' | 'geo' (hexagon-ish, the "unusual" case) */
function synth(kind) {
  const W = 320, H = 130, cy = 65;
  const data = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  const set = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  for (let i = 0; i < W * H; i++) set(i % W, (i / W) | 0, [232, 200, 176]);   // skin

  const lensR = 34, rim = 7;
  const centres = [95, 225];
  const shape = (x, y, cx) => {
    if (kind === 'rect') return Math.abs(x - cx) <= lensR && Math.abs(y - cy) <= lensR * 0.8;
    if (kind === 'geo') {                                    // 6-gon
      const dx = (x - cx) / lensR, dy = (y - cy) / (lensR * 0.85);
      const a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      const poke = 0.86 + 0.14 * Math.cos(6 * a);
      return r <= poke;
    }
    return ((x - cx) / lensR) ** 2 + ((y - cy) / (lensR * 0.82)) ** 2 <= 1;   // round
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let frame = false, hole = false;
    for (const cx of centres) {
      const outer = shape(x, y, cx);
      // erode ~rim px for the hole test
      const inner = shape(x, y, cx) && shape(x - rim, y, cx) && shape(x + rim, y, cx)
                 && shape(x, y - rim, cx) && shape(x, y + rim, cx);
      if (outer && !inner) frame = true;
      if (inner) hole = true;
    }
    const bridge = x > centres[0] + lensR - 4 && x < centres[1] - lensR + 4 && Math.abs(y - (cy - 14)) < 4;
    if (bridge) frame = true;
    if (frame) { mask[y * W + x] = 1; set(x, y, [70, 48, 34]); }        // brown rim
    else if (hole) { set(x, y, [225, 225, 228]); }                     // clear lens
  }
  // landmarks: eyes at the lens centres
  const lm = [];
  lm[33] = { x: 78 / W, y: cy / H };
  lm[263] = { x: 242 / W, y: cy / H };
  lm[468] = { x: centres[0] / W, y: cy / H };
  lm[473] = { x: centres[1] / W, y: cy / H };
  return { img: { data, width: W, height: H }, mask, W, H, lm };
}

/* round: outline preserved, 2 real holes, brown frame, clear lens */
{
  const g = synth('round');
  const a = buildAsset(g.img, g.mask, g.W, g.H, g.lm);
  assert.equal(a.ok, true);
  assert.equal(a.quality.hasHoles, true, 'found lens openings');
  assert.ok(a.geometry.lensL.length >= 6 && a.geometry.lensR.length >= 6);
  const ob = polyBBox(a.geometry.outline);
  assert.ok(ob.w > 0.9 && ob.w < 1.15, 'outline normalised to ~1 wide: ' + ob.w.toFixed(2));
  assert.ok(a.dimensions.aspect > 2 && a.dimensions.aspect < 4);
  const fr = parseInt(a.frameColor.slice(1, 3), 16), fb = parseInt(a.frameColor.slice(5, 7), 16);
  assert.ok(fr > fb, 'frame colour reads warm/brown, got ' + a.frameColor);
  assert.ok(a.lensOpacity < 0.2, 'clear lens low opacity');
  assert.ok(a.placement.spanRatio >= 1.15 && a.placement.spanRatio <= 2.2, 'spanRatio ' + a.placement.spanRatio);
}

/* rect: NOT forced to a preset — its own traced outline + real lens holes */
{
  const g = synth('rect');
  const a = buildAsset(g.img, g.mask, g.W, g.H, g.lm);
  assert.equal(a.ok, true);
  assert.equal(a.quality.hasHoles, true);
  const ob = polyBBox(a.geometry.outline);
  assert.ok(ob.h > 0.18 && ob.w > 0.9, 'rect outline has real extent');
  // rect lens polygon has near-right-angle turns -> its bbox fill is high
  const lb = polyBBox(a.geometry.lensL);
  assert.ok(lb.w > 0.1 && lb.h > 0.1, 'lens polygon has extent');
}

/* geo (6-gon "unusual"): still ok, holes found, outline not collapsed to few points */
{
  const g = synth('geo');
  const a = buildAsset(g.img, g.mask, g.W, g.H, g.lm);
  assert.equal(a.ok, true);
  assert.ok(a.geometry.outline.length >= 10, 'unusual shape keeps contour detail: ' + a.geometry.outline.length);
}

/* garbage mask -> ok:false but a usable fallback asset */
{
  const g = synth('round');
  const junk = new Uint8Array(g.W * g.H);
  for (let k = 0; k < 30; k++) junk[(k * 911) % junk.length] = 1;
  const a = buildAsset(g.img, junk, g.W, g.H, g.lm);
  assert.equal(a.ok, false);
  assert.ok(a.geometry.outline.length > 3, 'fallback still has geometry');
  assert.ok(Array.isArray(a.geometry.lensL));
}

console.log('ok');
