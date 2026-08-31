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
