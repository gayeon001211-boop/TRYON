import assert from 'node:assert/strict';
import { classifyMaterial, materialParams, classifyShape } from './src/material.js';

const W = 60, H = 60;
function scene(paint) {
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = paint(x, y);
    if (!c) continue;
    mask[y * W + x] = 1;
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
  }
  return { img, mask };
}

// a solid dark moulded colour
{
  const { img, mask } = scene(() => [42, 40, 38]);
  assert.equal(classifyMaterial(img, mask, W, H).kind, 'acetate');
}
// polished metal: a dark body with a few blown-out highlights
{
  const { img, mask } = scene((x, y) => (x % 17 === 0 && y % 3 === 0 ? [250, 250, 250] : [96, 96, 100]));
  const m = classifyMaterial(img, mask, W, H);
  assert.equal(m.kind, 'metal', 'metal, got ' + m.kind + ' specular ' + m.specular);
}
// clear acetate: light and even
{
  const { img, mask } = scene(() => [214, 210, 206]);
  assert.equal(classifyMaterial(img, mask, W, H).kind, 'transparent');
}
// tortoiseshell: browns swinging between amber and near-black
{
  const { img, mask } = scene((x, y) => ((x + y) % 7 < 3 ? [150, 92, 20] : [48, 28, 12]));
  const m = classifyMaterial(img, mask, W, H);
  assert.equal(m.kind, 'patterned', 'patterned, got ' + m.kind + ' satVar ' + m.satVar);
}
// too little to judge
assert.equal(classifyMaterial({ data: new Uint8ClampedArray(16) }, new Uint8Array(4), 2, 2).confidence, 0);

// material parameters actually differ where it matters
assert.ok(materialParams('metal').metalness > 0.8);
assert.ok(materialParams('transparent').transmission > 0.5);
assert.equal(materialParams('acetate').metalness, 0);
assert.ok(materialParams('metal').depthScale < 1, 'a wire front is not 5mm deep');

// construction, read off the rim profile
{
  const n = 128, lensW = 0.38;
  const ring = v => Float64Array.from({ length: n }, () => v);
  assert.equal(classifyShape(ring(0.04), lensW).kind, 'fullrim');
  assert.equal(classifyShape(ring(0.012), lensW).kind, 'wire');
  assert.equal(classifyShape(ring(0.005), lensW).kind, 'rimless');

  const brow = Float64Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return a > Math.PI * 0.2 && a < Math.PI * 0.8 ? 0.03 : 0.002;   // material only on top
  });
  assert.equal(classifyShape(brow, lensW).kind, 'browline');
}
console.log('ok');
