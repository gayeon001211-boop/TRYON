import assert from 'node:assert/strict';
import { poseFromEyes, smartFit, decomposeMatrix, eulerFromLandmarks } from './src/frame.js';

// eyes level, 100px apart in a 200x100 frame
let p = poseFromEyes({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 200, 100);
assert.deepEqual([p.cx, p.cy, p.angle, p.eyeSpan], [100, 50, 0, 100]);

// head tilted 45 deg
p = poseFromEyes({ x: 0, y: 0 }, { x: 1, y: 1 }, 100, 100);
assert.ok(Math.abs(p.angle - Math.PI / 4) < 1e-9);

// mirrored eye landmarks (x order flipped) still read as ~level, not upside-down
p = poseFromEyes({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.5 }, 200, 100);
assert.ok(Math.abs(p.angle) < 1e-9, 'folded roll: ' + p.angle);

// decomposeMatrix: identity
let d = decomposeMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
assert.deepEqual([d.x, d.y, d.z], [0, 0, 0]);
assert.ok(Math.abs(d.rx) < 1e-9 && Math.abs(d.ry) < 1e-9 && Math.abs(d.rz) < 1e-9);
assert.ok(Math.abs(d.scale - 1) < 1e-9);

// decomposeMatrix: 90deg yaw about Y (column-major), translated
d = decomposeMatrix([0,0,-1,0, 0,1,0,0, 1,0,0,0, 3,0,0,1]);
assert.ok(Math.abs(d.ry - Math.PI / 2) < 1e-6);
assert.equal(d.x, 3);

// minimal landmark set
const mk = pts => { const a = []; for (const [i, x, y, z = 0] of pts) a[i] = { x, y, z }; return a; };
const face = mk([
  [33, 0.35, 0.45], [263, 0.65, 0.45],
  [234, 0.25, 0.5], [454, 0.75, 0.5],
  [168, 0.5, 0.44],
  [1, 0.5, 0.55], [10, 0.5, 0.2], [152, 0.5, 0.9],
]);

const fit = smartFit(face, { spanRatio: 1.55, yRatio: -0.09 }, 1, 1);
assert.ok(fit.w >= 0.6 && fit.w <= 1.6);
assert.ok(Math.abs(fit.w - (0.47 / (0.30 * 1.55))) < 0.02);
assert.equal(fit.h, 1);

let e = eulerFromLandmarks(face);
assert.ok(Math.abs(e.yaw) < 0.05);
e = eulerFromLandmarks(mk([[33,0.35,0.45],[263,0.65,0.45],[1,0.62,0.55],[10,0.5,0.2],[152,0.5,0.9]]));
assert.ok(e.yaw > 0.1);

console.log('ok');
