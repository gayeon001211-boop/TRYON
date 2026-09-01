// Measure the wearer, so the uploaded frame has something real to be measured against.
//
// Everything the extractor produces is a ratio to the frame's own width — it never knows
// millimetres, and the try-on placement is guessed from whatever face happened to be in
// the reference photo. Measuring the person first turns the face into the ruler: the
// frame gets sized to THIS head, the temples get a length that was measured rather than
// invented, and the design can be quoted in real eyewear numbers (52 □ 18 − 145).
//
// The one assumption is scale. Average adult pupillary distance is ~63 mm; the user can
// type their own (it is printed on every eyeglass prescription). Everything else is
// derived from that, linearly, so a corrected PD instantly corrects every measurement.
//
// Pure — no DOM. See test_face.mjs.

export const DEFAULT_PD_MM = 63;
const EAR_HOOK_MM = 35;          // ponytail: standard allowance for the bend behind the ear

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// MediaPipe FaceLandmarker indices
const L = {
  irisL: 468, irisR: 473,        // iris centres — the steadiest points in the mesh
  eyeL: 33, eyeR: 263,           // outer eye corners (fallback when iris is absent)
  templeL: 234, templeR: 454,    // face silhouette at the temples
  browL: 105, browR: 334,
  bridge: 168,                   // top of the nose bridge, where a frame rests
  chin: 152, forehead: 10,
};

const at = (lm, i, w, h) => ({ x: lm[i].x * w, y: lm[i].y * h, z: (lm[i].z ?? 0) * w });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * One frame's worth of face measurements, in millimetres.
 * `lm` is a MediaPipe landmark list; `pdMm` is the scale anchor.
 */
export function measureFace(lm, w, h, pdMm = DEFAULT_PD_MM) {
  if (!lm || !lm[L.eyeL] || !lm[L.eyeR]) return null;

  const hasIris = Boolean(lm[L.irisL] && lm[L.irisR]);
  const pL = at(lm, hasIris ? L.irisL : L.eyeL, w, h);
  const pR = at(lm, hasIris ? L.irisR : L.eyeR, w, h);
  const pdPx = dist(pL, pR);
  if (!(pdPx > 1)) return null;

  // without iris landmarks the outer corners are ~1.35x wider apart than the pupils
  const mmPerPx = pdMm / (hasIris ? pdPx : pdPx / 1.35);

  const tL = at(lm, L.templeL, w, h), tR = at(lm, L.templeR, w, h);
  const eyeMidY = (pL.y + pR.y) / 2;

  // How square-on is the head? A turned head puts the eye midpoint off the midpoint of
  // the temples, and narrows faceWidthMm with it — the one error the wearer can fix by
  // looking straight ahead, so it is measured and reported rather than corrected for.
  // (frame.js's eulerFromLandmarks needs the nose tip and is tuned for 3D pose; this is
  // the asymmetry that actually biases these numbers.)
  const faceHalf = dist(tL, tR) / 2 || 1e-3;
  const off = clamp(((pL.x + pR.x) / 2 - (tL.x + tR.x) / 2) / faceHalf, -1, 1);
  const browY = (at(lm, L.browL, w, h).y + at(lm, L.browR, w, h).y) / 2;

  // the arm runs from the hinge (out at the temple) back to the ear, then hooks over it.
  // MediaPipe z is relative but scaled with the face, so mmPerPx carries it too.
  const hingeL = { x: tL.x, y: browY, z: at(lm, L.eyeL, w, h).z };
  const templeReachMm = (dist3(hingeL, tL) + Math.abs(tL.z - hingeL.z)) * mmPerPx + EAR_HOOK_MM;

  return {
    pdMm,
    yawDeg: +(Math.asin(off) * 180 / Math.PI).toFixed(1),
    mmPerPx: +mmPerPx.toFixed(5),
    hasIris,
    pdPx: +pdPx.toFixed(2),
    faceWidthMm: +(dist(tL, tR) * mmPerPx).toFixed(1),
    faceHeightMm: +(dist(at(lm, L.forehead, w, h), at(lm, L.chin, w, h)) * mmPerPx).toFixed(1),
    browAboveEyeMm: +((eyeMidY - browY) * mmPerPx).toFixed(1),
    bridgeDropMm: +((at(lm, L.bridge, w, h).y - eyeMidY) * mmPerPx).toFixed(1),
    templeLenMm: +clamp(templeReachMm, 110, 165).toFixed(1),
  };
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Degrees of head turn past which faceWidthMm is measurably short. */
export const YAW_LIMIT_DEG = 12;

/**
 * Median of several frames — a single frame jitters by a millimetre or two. It also
 * reports how the measurement went: how many frames landed, how far apart they were,
 * and how far the head was turned. Without those three the wearer has no way to tell a
 * good measurement from a bad one, and every number downstream is scaled by this one.
 */
export function averageProfile(samples) {
  const ok = samples.filter(Boolean);
  if (!ok.length) return null;
  const keys = ['pdMm', 'mmPerPx', 'faceWidthMm', 'faceHeightMm', 'browAboveEyeMm', 'bridgeDropMm', 'templeLenMm'];
  const out = { frames: ok.length, hasIris: ok[0].hasIris };
  for (const k of keys) out[k] = +median(ok.map(s => s[k])).toFixed(k === 'mmPerPx' ? 5 : 1);
  const widths = ok.map(s => s.faceWidthMm).sort((a, b) => a - b);
  const q = f => widths[Math.min(widths.length - 1, Math.round(f * (widths.length - 1)))];
  out.spreadMm = +(q(0.9) - q(0.1)).toFixed(1);     // p90−p10: ignores a single bad frame
  out.yawDeg = +median(ok.map(s => s.yawDeg ?? 0)).toFixed(1);
  out.steady = out.frames >= 10 && out.spreadMm <= 1.5 && Math.abs(out.yawDeg) <= YAW_LIMIT_DEG;
  return out;
}

/** Re-scale a profile for a corrected PD. Every measurement is linear in it. */
export function withPd(profile, pdMm) {
  if (!profile) return null;
  const k = pdMm / profile.pdMm;
  const out = { ...profile, pdMm };
  for (const key of ['mmPerPx', 'faceWidthMm', 'faceHeightMm', 'browAboveEyeMm', 'bridgeDropMm', 'templeLenMm']) {
    out[key] = +(profile[key] * k).toFixed(key === 'mmPerPx' ? 5 : 1);
  }
  return out;
}

/**
 * The uploaded frame, quoted in eyewear's own units, sized to this face.
 * A frame front is fitted at about the width of the face; that one rule sets the
 * millimetre scale for every other dimension of the design.
 */
export function frameSpecMm(spec, profile, fill = 0.98) {
  if (!spec || !profile) return null;
  const frontMm = profile.faceWidthMm * fill;       // spec space: the front is 1.0 wide
  const mm = v => +(v * frontMm).toFixed(0);
  const lensMm = mm(spec.lensW);
  const bridgeMm = mm(Math.max(0, spec.halfGap * 2 - spec.lensW));
  return {
    frontMm: +frontMm.toFixed(0),
    lensMm, bridgeMm, lensHeightMm: mm(spec.lensH),
    templeMm: Math.round(profile.templeLenMm),
    label: `${lensMm} □ ${bridgeMm} − ${Math.round(profile.templeLenMm)}`,
    fit: frontMm < profile.faceWidthMm * 0.9 ? 'narrow'
       : frontMm > profile.faceWidthMm * 1.06 ? 'wide' : 'good',
  };
}

/**
 * Where this frame should sit on this face, from the wearer rather than from whatever
 * face was in the reference photo.
 */
export function placementFor(profile, spec, fill = 0.98) {
  if (!profile || !spec) return null;
  const eyeSpanMm = profile.hasIris ? profile.pdMm : profile.pdMm * 1.35;
  const frontMm = profile.faceWidthMm * fill;
  return {
    spanRatio: +clamp(frontMm / eyeSpanMm, 1.2, 2.0).toFixed(3),
    // sit the top rim just under the brow: the frame centre lands between brow and eye
    yRatio: +clamp((-profile.browAboveEyeMm * 0.45) / eyeSpanMm, -0.2, 0.1).toFixed(3),
  };
}
