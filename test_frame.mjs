import assert from 'node:assert/strict';
import { poseFromEyes, sampleCorners, keyOut } from './frame.js';

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

console.log('ok');
