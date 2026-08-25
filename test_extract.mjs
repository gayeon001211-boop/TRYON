import assert from 'node:assert/strict';
import { maskGlasses } from './src/extract.js';

// synthetic face crop: light skin, a dark frame bar across the eye line,
// a dark hair corner and a dark pupil dot that must both be dropped
const w = 100, h = 60, data = new Uint8ClampedArray(w * h * 4).fill(255);
const set = (x, y, v) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; };
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 200);       // skin
for (let y = 25; y < 35; y++) for (let x = 5; x < 95; x++) set(x, y, 20);     // frame
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set(x, y, 15);        // hair corner
for (let y = 19; y < 22; y++) for (let x = 48; x < 51; x++) set(x, y, 10);    // pupil

maskGlasses({ width: w, height: h, data }, 1);
const alpha = (x, y) => data[(y * w + x) * 4 + 3];
assert.equal(alpha(50, 30), 255, 'frame kept');
assert.equal(alpha(50, 10), 0, 'skin cut');
assert.equal(alpha(2, 2), 0, 'hair cut');
assert.equal(alpha(49, 20), 0, 'pupil cut');

console.log('ok');
