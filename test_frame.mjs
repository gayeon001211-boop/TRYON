import assert from 'node:assert/strict';
import { poseFromEyes, sampleCorners, keyOut, smartFit, decomposeMatrix, eulerFromLandmarks } from './src/frame.js';

// eyes level, 100px apart in a 200x100 frame
let p = poseFromEyes({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 200, 100);
assert.deepEqual([p.cx, p.cy, p.angle, p.eyeSpan], [100, 50, 0, 100]);

// head tilted 45 deg
p = poseFromEyes({ x: 0, y: 0 }, { x: 1, y: 1 }, 100, 100);
assert.ok(Math.abs(p.angle - Math.PI / 4) < 1e-9);

// 2x2 white image with one red pixel: corners read white, keyOut cuts 3
const px = new Uint8ClampedArray([
  255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 10, 0, 0, 255,
]);
assert.deepEqual(sampleCorners(px, 2, 2), [194, 191, 191]); // red corner drags the mean
assert.equal(keyOut(px, [255, 255, 255], 30), 3);
assert.equal(px[15], 255); // red pixel survives

// decomposeMatrix: identity -> no translation, no rotation, unit scale
let d = decomposeMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
assert.deepEqual([d.x, d.y, d.z], [0, 0, 0]);
assert.ok(Math.abs(d.rx) < 1e-9 && Math.abs(d.ry) < 1e-9 && Math.abs(d.rz) < 1e-9);
assert.ok(Math.abs(d.scale - 1) < 1e-9);

// decomposeMatrix: 90deg yaw about Y (column-major), translated
d = decomposeMatrix([0,0,-1,0, 0,1,0,0, 1,0,0,0, 3,0,0,1]);
assert.ok(Math.abs(d.ry - Math.PI / 2) < 1e-6);
assert.equal(d.x, 3);

// build a minimal landmark set (only the indices the helpers read)
const mk = pts => { const a = []; for (const [i, x, y, z = 0] of pts) a[i] = { x, y, z }; return a; };
const face = mk([
  [33, 0.35, 0.45], [263, 0.65, 0.45],   // eye corners, level, span .30
  [234, 0.25, 0.5], [454, 0.75, 0.5],    // cheeks, face width .50
  [168, 0.5, 0.44],                       // brow, slightly above eye line
  [1, 0.5, 0.55], [10, 0.5, 0.2], [152, 0.5, 0.9],
]);

// smartFit: face width .50, target frame width .94*.50=.47; eyeSpan*spanRatio = .30*1.55
const fit = smartFit(face, { spanRatio: 1.55, yRatio: -0.09 }, 1, 1);
assert.ok(fit.w >= 0.6 && fit.w <= 1.6);
assert.ok(Math.abs(fit.w - (0.47 / (0.30 * 1.55))) < 0.02);
assert.equal(fit.h, 1);

// eulerFromLandmarks: symmetric face -> near-zero yaw
let e = eulerFromLandmarks(face);
assert.ok(Math.abs(e.yaw) < 0.05);
// nose pushed right -> positive yaw
e = eulerFromLandmarks(mk([[33,0.35,0.45],[263,0.65,0.45],[1,0.62,0.55],[10,0.5,0.2],[152,0.5,0.9]]));
assert.ok(e.yaw > 0.1);

console.log('ok');
