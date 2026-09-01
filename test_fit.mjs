import assert from 'node:assert/strict';
import { rasterSpec, iou, fitSpec, applyFit, IDENTITY, shrink } from './src/fit.js';

const TAU = Math.PI * 2;
// a plausible measured frame: wide oval lenses, a rim, end pieces, a bridge
function spec(n = 96) {
  const lensR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    lensR[i] = 1 / Math.hypot(Math.cos(a) / 0.19, Math.sin(a) / 0.10);   // ellipse
  }
  return {
    n, lensR, lensW: 0.38, lensH: 0.20, halfGap: 0.245, centreY: 0.02,
    rimW: 0.045, depth: 0.045,
    bridge: { y: 0.06, span: 0.05, needed: true, thick: 0.04, arch: 0.02 },
    endPiece: { x: 0.44, y: 0.05, w: 0.10, h: 0.06, size: 0.05 },
  };
}
const tf = { cx: 128, cy: 80, scale: 240 };
const W = 256, H = 160;

// the raster is a plausible frame: two openings, material around them
{
  const m = rasterSpec(spec(), IDENTITY, tf, W, H);
  const filled = m.reduce((a, b) => a + b, 0);
  assert.ok(filled > 500 && filled < W * H * 0.5, 'covers a frame-sized area, got ' + filled);
  assert.equal(m[80 * W + 128 - 59], 0, 'left lens is an opening');   // lens centre
  assert.equal(iou(m, m), 1, 'iou of a mask with itself');
}

// round trip: distort a known frame, then let the fit find its way back
{
  const s = spec();
  const truth = { ...IDENTITY, sx: 1.18, sy: 0.88, gap: 1.09, rim: 1.3, tx: 0.02 };
  const target = rasterSpec(s, truth, tf, W, H);

  const before = iou(rasterSpec(s, IDENTITY, tf, W, H), target);
  const { params, iou: after, evals } = fitSpec(s, target, W, H, tf, { rounds: 9 });

  assert.ok(after > before, `fit improved IoU: ${before.toFixed(3)} -> ${after}`);
  assert.ok(after > 0.95, 'recovers the frame, IoU ' + after);
  for (const k of ['sx', 'sy', 'gap']) {
    assert.ok(Math.abs(params[k] - truth[k]) < 0.06, `${k} recovered: ${params[k]} vs ${truth[k]}`);
  }
  assert.ok(evals < 600, 'stays cheap, ' + evals + ' rasterisations');

  // the fitted parameters bake into a spec that renders the same shape
  // tx/ty/rot are alignment, not shape: they come back as `placement` and are re-applied
  const baked = applyFit(s, params);
  const pose = { ...IDENTITY, ...baked.placement };
  assert.ok(iou(rasterSpec(baked, pose, tf, W, H), target) > 0.93, 'applyFit keeps the match');
  assert.ok(baked.rimProfile.length === baked.n, 'bakes a per-angle rim');
}

// downsampling keeps the shape recognisable
{
  const m = rasterSpec(spec(), IDENTITY, tf, W, H);
  const small = shrink(m, W, H, 128);
  assert.equal(small.width, 128);
  assert.ok(small.mask.reduce((a, b) => a + b, 0) > 100, 'survives the shrink');
}

console.log('ok');
