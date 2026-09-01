import assert from 'node:assert/strict';
import { radialProfile, lowPass, canonicalLens, polyFromProfile, eyewearSpec } from './src/eyewear.js';

const circle = (cx, cy, rad, n = 40) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
});

// a circle profiles to a constant radius, and low-pass leaves it alone
const { c, r } = radialProfile(circle(2, -1, 0.3), 64);
assert.ok(Math.abs(c[0] - 2) < 1e-6 && Math.abs(c[1] + 1) < 1e-6, 'centroid');
assert.ok([...r].every(v => Math.abs(v - 0.3) < 0.02), 'constant radius');
assert.ok([...lowPass(r, 6)].every(v => Math.abs(v - 0.3) < 0.02), 'low-pass keeps a circle');

// a spike is smoothed away
const spiky = Float64Array.from({ length: 64 }, (_, i) => (i === 10 ? 1 : 0.3));
assert.ok(Math.max(...lowPass(spiky, 6)) < 0.55, 'spike flattened');

// the canonical lens is symmetric even when the two traces differ
const lens = canonicalLens(circle(-0.3, 0, 0.22), circle(0.3, 0, 0.28), 64);
for (let i = 1; i < 32; i++) {
  assert.ok(Math.abs(lens.r[i] - lens.r[64 - i]) < 0.02, 'mirror symmetric at ' + i);
}

// a spec built from those measurements is wearable-shaped
const spec = eyewearSpec({
  geometry: { lensL: circle(-0.28, 0, 0.2), lensR: circle(0.28, 0, 0.2) },
  dimensions: { rimRatio: 0.4, depth: 0.5 },
}, 64);
assert.ok(spec.rimW <= spec.lensW * 0.14 + 1e-9, 'rim capped to something mouldable');
assert.ok(spec.depth <= 0.09, 'depth capped');
assert.ok(spec.bridge.span > 0, 'bridge spans the gap');
assert.equal(polyFromProfile(spec.lensR, 0, 0).length, 64);

console.log('ok');

// rim thickness varies around the lens: thick on top, fine underneath
{
  const { rimProfileOf } = await import('./src/eyewear.js');
  const n = 128;
  const lens = [], outline = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rl = 0.2;
    const thick = Math.sin(a) > 0 ? 0.09 : 0.03;      // top heavy
    lens.push([Math.cos(a) * rl, Math.sin(a) * rl]);
    outline.push([Math.cos(a) * (rl + thick), Math.sin(a) * (rl + thick)]);
  }
  const { profile } = rimProfileOf(lens, outline, -1, n, 0.05);
  const top = profile[n / 4], bottom = profile[(3 * n) / 4];
  // smoothed, and half the circle is filled with the median, so the step is softened —
  // what matters is that thickness follows the angle instead of being one number
  assert.ok(top > bottom * 1.4, `top rim thicker: ${top.toFixed(3)} vs ${bottom.toFixed(3)}`);
  assert.ok(top < 0.12 && bottom > 0.015, 'stays near the measured values');

  // a constant-thickness ring stays constant
  const lens2 = [], out2 = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lens2.push([Math.cos(a) * 0.2, Math.sin(a) * 0.2]);
    out2.push([Math.cos(a) * 0.25, Math.sin(a) * 0.25]);
  }
  const flat = rimProfileOf(lens2, out2, -1, n, 0.05).profile;
  const spread = Math.max(...flat) - Math.min(...flat);
  assert.ok(spread < 0.006, 'uniform rim stays uniform, spread ' + spread.toFixed(4));
}
console.log('ok');
