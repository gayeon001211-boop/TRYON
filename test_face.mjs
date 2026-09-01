import assert from 'node:assert/strict';
import { measureFace, averageProfile, withPd, frameSpecMm, placementFor, DEFAULT_PD_MM }
  from './src/faceProfile.js';

const W = 1280, H = 720;
// a synthetic head: pupils 60 px apart, temples 130 px apart, brow 18 px above the eyes
function face(jitter = 0) {
  const j = () => (Math.random() - 0.5) * jitter;
  const lm = [];
  const put = (i, x, y, z = 0) => { lm[i] = { x: (x + j()) / W, y: (y + j()) / H, z: z / W }; };
  put(468, 610, 300); put(473, 670, 300);          // iris centres, 60 px
  put(33, 590, 300); put(263, 690, 300);           // outer eye corners
  put(234, 575, 310, 40); put(454, 705, 310, 40);  // temples, 130 px
  put(105, 605, 282); put(334, 675, 282);          // brows, 18 px above
  put(168, 640, 312);                              // nose bridge
  put(10, 640, 190); put(152, 640, 470);           // forehead, chin
  return lm;
}

// known geometry in, known millimetres out
{
  const p = measureFace(face(), W, H, DEFAULT_PD_MM);
  assert.ok(p.hasIris, 'uses the iris landmarks');
  assert.ok(Math.abs(p.pdPx - 60) < 0.01, 'pupil distance in pixels');
  // 63 mm over 60 px = 1.05 mm/px; 130 px of face is then 136.5 mm
  assert.ok(Math.abs(p.mmPerPx - 1.05) < 0.001, 'scale ' + p.mmPerPx);
  assert.ok(Math.abs(p.faceWidthMm - 136.5) < 1, 'face width ' + p.faceWidthMm);
  assert.ok(Math.abs(p.browAboveEyeMm - 18.9) < 1, 'brow height ' + p.browAboveEyeMm);
  assert.ok(p.templeLenMm >= 110 && p.templeLenMm <= 165, 'temple in a wearable range');
}

// a corrected PD rescales everything, exactly in proportion
{
  const p = measureFace(face(), W, H, 63);
  const q = withPd(p, 70);
  assert.equal(q.pdMm, 70);
  assert.ok(Math.abs(q.faceWidthMm / p.faceWidthMm - 70 / 63) < 0.001, 'linear in PD');
}

// the median settles a shaky measurement
{
  const shaky = Array.from({ length: 30 }, () => measureFace(face(6), W, H));
  const avg = averageProfile(shaky);
  const clean = measureFace(face(0), W, H);
  assert.equal(avg.frames, 30);
  assert.ok(Math.abs(avg.faceWidthMm - clean.faceWidthMm) < 3, 'median is close to the truth');
}

// the frame is quoted in eyewear units and judged against the face
{
  const profile = measureFace(face(), W, H);
  const spec = { lensW: 0.38, lensH: 0.2, halfGap: 0.245 };
  const s = frameSpecMm(spec, profile);
  assert.ok(/^\d+ □ \d+ − \d+$/.test(s.label), 'reads like a frame size: ' + s.label);
  assert.ok(s.lensMm > 30 && s.lensMm < 70, 'plausible lens width ' + s.lensMm);
  assert.equal(s.fit, 'good');

  const place = placementFor(profile, spec);
  assert.ok(place.spanRatio > 1.2 && place.spanRatio < 2.6, 'span ' + place.spanRatio);
  assert.ok(place.yRatio < 0, 'the frame sits above the eye centres');
}

// no face, no guesses
assert.equal(measureFace(null, W, H), null);
assert.equal(averageProfile([null, null]), null);
assert.equal(frameSpecMm(null, null), null);

console.log('ok');
