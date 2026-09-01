import assert from 'node:assert/strict';
import { buildAsset, foregroundFromBackground, pointsFromMask } from './src/glassesAsset.js';
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

/* geo (6-gon "unusual"): the real contour is ALWAYS kept — never swapped for a preset.
   `ok` may be false (low confidence) but geometry must be the trace, not the fallback. */
{
  const g = synth('geo');
  const a = buildAsset(g.img, g.mask, g.W, g.H, g.lm);
  assert.ok(!a.reason, 'a contour was traced, not the fallback: ' + a.reason);
  assert.ok(a.geometry.outline.length >= 10, 'unusual shape keeps contour detail: ' + a.geometry.outline.length);
  // the fallback ellipse is exactly 40 points at radius 0.54 — make sure we are NOT that
  const ob = polyBBox(a.geometry.outline);
  assert.ok(Math.abs(ob.w - 1.08) > 0.001 || a.geometry.outline.length !== 40, 'not the canned fallback');
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

/* foregroundFromBackground: glasses on a plain white wall, no face */
{
  const W = 300, H = 120, cy = 60;
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  for (let i = 0; i < W * H; i++) set(i % W, (i / W) | 0, [248, 248, 246]);      // white wall
  const lensR = 34;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (const cx of [88, 212]) {
      const n = ((x - cx) / lensR) ** 2 + ((y - cy) / (lensR * 0.8)) ** 2;
      if (n <= 1 && n > 0.6) set(x, y, [60, 45, 35]);                            // dark rim
      else if (n <= 0.6) set(x, y, [90, 150, 90]);                              // green lens (≠ wall)
    }
    if (x > 118 && x < 182 && Math.abs(y - (cy - 12)) < 4) set(x, y, [60, 45, 35]);
  }
  const fg = foregroundFromBackground({ data, width: W, height: H }, W, H);
  assert.equal(fg.plainBg, true, 'white wall reads as plain, spread ' + fg.spread);
  assert.equal(fg.mask[cy * W + 88], 1, 'lens region is foreground');
  assert.equal(fg.mask[2 * W + 2], 0, 'corner is background');

  const a = buildAsset({ data, width: W, height: H }, fg.mask, W, H, null);
  assert.ok(!a.reason, 'built from bg-key mask: ' + a.reason);
  assert.equal(a.quality.hasHoles, true, 'green lenses split out from the dark rim');
  const fr = parseInt(a.frameColor.slice(1, 3), 16), fg2 = parseInt(a.frameColor.slice(3, 5), 16);
  assert.ok(fr < 110 && fg2 < 110, 'frame colour reads dark, got ' + a.frameColor);
}


// pointsFromMask: a design sheet is TWO elevations of the same glasses. The prompt has to
// point at the front one, in the frame material, and say "not that" about the other.
{
  const W = 200, H = 200;
  const mask = new Uint8Array(W * H);
  // front view: a rectangular ring, y 20..80, with a hole at x 60..140 / y 35..65
  for (let y = 20; y <= 80; y++) for (let x = 20; x <= 180; x++) {
    const inHole = x >= 60 && x <= 140 && y >= 35 && y <= 65;
    if (!inHole) mask[y * W + x] = 1;
  }
  // side view below, deliberately smaller — a solid blob, y 120..170
  for (let y = 120; y <= 170; y++) for (let x = 40; x <= 120; x++) mask[y * W + x] = 1;

  const pts = pointsFromMask(mask, W, H);
  const pos = pts.filter(q => q.label === 1), neg = pts.filter(q => q.label === 0);
  assert.ok(pos.length >= 6, 'enough positives: ' + pos.length);
  for (const q of pos) {
    const [x, y] = q.p;
    assert.equal(mask[y * W + x], 1, `positive (${x},${y}) is on frame material`);
    assert.ok(y < 100, `positive (${x},${y}) is on the front view, not the side one`);
  }
  // no negative inside the lens opening: buildAsset carves those itself and needs a solid
  // front to do it with — see pointsFromMask
  assert.ok(!neg.some(q => q.p[0] > 60 && q.p[0] < 140 && q.p[1] > 35 && q.p[1] < 65),
            'the lens opening is left alone');
  assert.ok(neg.some(q => q.p[1] >= 120 && q.p[1] <= 170 && q.p[0] >= 40 && q.p[0] <= 120),
            'a negative sits on the second elevation');
  // no negative to the left or right of the frame: a pale end piece the key missed
  // must not be ruled out
  assert.ok(!neg.some(q => q.p[1] > 20 && q.p[1] < 80 && (q.p[0] < 20 || q.p[0] > 180) && q.p[1] > 5 && q.p[1] < 195),
            'nothing vetoed beside the frame');

  // scale maps to the full-size image the model is prompted at
  const big = pointsFromMask(mask, W, H, 4);
  assert.deepEqual(big[0].p, [pts[0].p[0] * 4, pts[0].p[1] * 4]);

  assert.equal(pointsFromMask(new Uint8Array(W * H), W, H), null, 'an empty mask says nothing');
}

console.log('ok');

// --- the tilted-selfie failure: a rotated eye line used to let the room in ---
{
  const { bandCrop, pairBalance } = await import('./src/glassesAsset.js');
  const w = 200, h = 200, mask = new Uint8Array(w * h);
  const put = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  };
  // head tilted ~27°: left eye at (70,110), right eye at (130,80)
  const lm = []; lm[33] = { x: 70 / w, y: 110 / h }; lm[263] = { x: 130 / w, y: 80 / h };
  put(58, 96, 88, 124);      // left lens, on the eye line
  put(112, 66, 142, 94);     // right lens, on the eye line
  put(6, 6, 46, 40);         // the desk in the corner — must not survive

  const kept = bandCrop(mask, w, h, lm);
  const inRect = (m, x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += m[y * w + x];
    return n;
  };
  assert.equal(inRect(kept, 0, 0, 50, 50), 0, 'background blob dropped');
  assert.ok(inRect(kept, 58, 96, 88, 124) > 700, 'left lens kept');
  assert.ok(inRect(kept, 112, 66, 142, 94) > 700, 'right lens kept');

  // and the pair check accepts two lenses but rejects one lens plus junk
  assert.equal(pairBalance(kept, w, h, lm).ok, true, 'a mirrored pair passes');
  const oneSided = new Uint8Array(w * h);
  for (let y = 96; y < 124; y++) for (let x = 58; x < 88; x++) oneSided[y * w + x] = 1;
  assert.equal(pairBalance(oneSided, w, h, lm).ok, false, 'a single blob is not a frame');
}

// pointsFromMask: a design sheet is TWO elevations of the same glasses. The prompt has to
// point at the front one, in the frame material, and say "not that" about the other.
{
  const W = 200, H = 200;
  const mask = new Uint8Array(W * H);
  // front view: a rectangular ring, y 20..80, with a hole at x 60..140 / y 35..65
  for (let y = 20; y <= 80; y++) for (let x = 20; x <= 180; x++) {
    const inHole = x >= 60 && x <= 140 && y >= 35 && y <= 65;
    if (!inHole) mask[y * W + x] = 1;
  }
  // side view below, deliberately smaller — a solid blob, y 120..170
  for (let y = 120; y <= 170; y++) for (let x = 40; x <= 120; x++) mask[y * W + x] = 1;

  const pts = pointsFromMask(mask, W, H);
  const pos = pts.filter(q => q.label === 1), neg = pts.filter(q => q.label === 0);
  assert.ok(pos.length >= 6, 'enough positives: ' + pos.length);
  for (const q of pos) {
    const [x, y] = q.p;
    assert.equal(mask[y * W + x], 1, `positive (${x},${y}) is on frame material`);
    assert.ok(y < 100, `positive (${x},${y}) is on the front view, not the side one`);
  }
  // no negative inside the lens opening: buildAsset carves those itself and needs a solid
  // front to do it with — see pointsFromMask
  assert.ok(!neg.some(q => q.p[0] > 60 && q.p[0] < 140 && q.p[1] > 35 && q.p[1] < 65),
            'the lens opening is left alone');
  assert.ok(neg.some(q => q.p[1] >= 120 && q.p[1] <= 170 && q.p[0] >= 40 && q.p[0] <= 120),
            'a negative sits on the second elevation');
  // no negative to the left or right of the frame: a pale end piece the key missed
  // must not be ruled out
  assert.ok(!neg.some(q => q.p[1] > 20 && q.p[1] < 80 && (q.p[0] < 20 || q.p[0] > 180) && q.p[1] > 5 && q.p[1] < 195),
            'nothing vetoed beside the frame');

  // scale maps to the full-size image the model is prompted at
  const big = pointsFromMask(mask, W, H, 4);
  assert.deepEqual(big[0].p, [pts[0].p[0] * 4, pts[0].p[1] * 4]);

  assert.equal(pointsFromMask(new Uint8Array(W * H), W, H), null, 'an empty mask says nothing');
}

console.log('ok');

// --- head pose: a photo taken at an angle measures short, and we undo that ---
{
  const { headPose } = await import('./src/glassesAsset.js');
  const straight = headPose(null, null);
  assert.equal(straight.kx, 1); assert.equal(straight.ky, 1);
  assert.equal(straight.from, 'none');

  // landmarks of a head turned to one side: nose off the eye midpoint
  const lm = [];
  lm[1] = { x: 0.56, y: 0.5 }; lm[33] = { x: 0.45, y: 0.5 }; lm[263] = { x: 0.62, y: 0.5 };
  lm[10] = { x: 0.53, y: 0.3 }; lm[152] = { x: 0.53, y: 0.75 };
  const turned = headPose(null, lm);
  assert.equal(turned.from, 'landmarks');
  assert.ok(turned.kx > 1.01, 'a turned head widens the correction, kx ' + turned.kx.toFixed(3));

  // and a wildly turned head is reported, not corrected with a made-up number
  const wild = headPose(null, { ...lm, 1: { x: 0.95, y: 0.5 } });
  assert.ok(wild.kx >= 1);
}

// pointsFromMask: a design sheet is TWO elevations of the same glasses. The prompt has to
// point at the front one, in the frame material, and say "not that" about the other.
{
  const W = 200, H = 200;
  const mask = new Uint8Array(W * H);
  // front view: a rectangular ring, y 20..80, with a hole at x 60..140 / y 35..65
  for (let y = 20; y <= 80; y++) for (let x = 20; x <= 180; x++) {
    const inHole = x >= 60 && x <= 140 && y >= 35 && y <= 65;
    if (!inHole) mask[y * W + x] = 1;
  }
  // side view below, deliberately smaller — a solid blob, y 120..170
  for (let y = 120; y <= 170; y++) for (let x = 40; x <= 120; x++) mask[y * W + x] = 1;

  const pts = pointsFromMask(mask, W, H);
  const pos = pts.filter(q => q.label === 1), neg = pts.filter(q => q.label === 0);
  assert.ok(pos.length >= 6, 'enough positives: ' + pos.length);
  for (const q of pos) {
    const [x, y] = q.p;
    assert.equal(mask[y * W + x], 1, `positive (${x},${y}) is on frame material`);
    assert.ok(y < 100, `positive (${x},${y}) is on the front view, not the side one`);
  }
  // no negative inside the lens opening: buildAsset carves those itself and needs a solid
  // front to do it with — see pointsFromMask
  assert.ok(!neg.some(q => q.p[0] > 60 && q.p[0] < 140 && q.p[1] > 35 && q.p[1] < 65),
            'the lens opening is left alone');
  assert.ok(neg.some(q => q.p[1] >= 120 && q.p[1] <= 170 && q.p[0] >= 40 && q.p[0] <= 120),
            'a negative sits on the second elevation');
  // no negative to the left or right of the frame: a pale end piece the key missed
  // must not be ruled out
  assert.ok(!neg.some(q => q.p[1] > 20 && q.p[1] < 80 && (q.p[0] < 20 || q.p[0] > 180) && q.p[1] > 5 && q.p[1] < 195),
            'nothing vetoed beside the frame');

  // scale maps to the full-size image the model is prompted at
  const big = pointsFromMask(mask, W, H, 4);
  assert.deepEqual(big[0].p, [pts[0].p[0] * 4, pts[0].p[1] * 4]);

  assert.equal(pointsFromMask(new Uint8Array(W * H), W, H), null, 'an empty mask says nothing');
}

console.log('ok');
