// Pure face-geometry helpers. No DOM, so they run under node for tests.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = v => Math.round(v * 100) / 100;

/** Face pose from the two outer eye-corner landmarks (already mirrored if the view is). */
export function poseFromEyes(a, b, w, h) {
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
  const dx = bx - ax, dy = by - ay;
  // the two landmarks can arrive in either x order (mirroring flips it), which would
  // swing `angle` by ±π and turn the frame upside down. Fold roll into [-90°, 90°].
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  return { cx: (ax + bx) / 2, cy: (ay + by) / 2, angle, eyeSpan: Math.hypot(dx, dy) };
}

// MediaPipe FaceLandmarker indices
const LM = { eyeL: 33, eyeR: 263, cheekL: 234, cheekR: 454, brow: 168, chin: 152, forehead: 10 };

/**
 * Suggest {w,h,y,r} so a frame sits like real glasses: about as wide as the face,
 * centred on the brow line. `frame` carries { spanRatio, yRatio }. Pure.
 */
export function smartFit(lm, frame, w, h) {
  const px = i => ({ x: lm[i].x * w, y: lm[i].y * h });
  const eyeSpan = Math.hypot(px(LM.eyeR).x - px(LM.eyeL).x, px(LM.eyeR).y - px(LM.eyeL).y);
  const faceW = Math.hypot(px(LM.cheekR).x - px(LM.cheekL).x, px(LM.cheekR).y - px(LM.cheekL).y);
  const spanRatio = frame?.spanRatio ?? 1.6;
  const wMul = clamp((faceW * 0.94) / (eyeSpan * spanRatio), 0.6, 1.6);
  const eyeMidY = (px(LM.eyeL).y + px(LM.eyeR).y) / 2;
  const yOff = clamp(((px(LM.brow).y - eyeMidY) / eyeSpan) - (frame?.yRatio ?? 0), -0.4, 0.4);
  return { w: round2(wMul), h: 1, y: round2(yOff), r: 0 };
}

/** yaw / pitch in radians from mirrored, normalised landmarks. Pure. */
export function eulerFromLandmarks(lm) {
  const nose = lm[1], eL = lm[33], eR = lm[263], fore = lm[10], chin = lm[152];
  const eyeMidX = (eL.x + eR.x) / 2, eyeMidY = (eL.y + eR.y) / 2;
  const half = Math.abs(eR.x - eL.x) / 2 || 1e-3;
  const yaw = clamp((nose.x - eyeMidX) / half, -1.3, 1.3) * 0.85;
  const faceH = Math.abs(chin.y - fore.y) || 1e-3;
  const pitch = clamp(((nose.y - eyeMidY) / faceH - 0.18) * 3.2, -0.8, 0.8);
  return { yaw, pitch };
}

/**
 * Decompose a column-major 4x4 (MediaPipe facial transform) into
 * { x,y,z, rx,ry,rz (radians, XYZ order), scale }. Pure.
 */
export function decomposeMatrix(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  const ry = Math.asin(clamp(r[6], -1, 1));
  const c = Math.cos(ry);
  const rx = Math.abs(c) > 1e-6 ? Math.atan2(-r[7], r[8]) : Math.atan2(r[5], r[4]);
  const rz = Math.abs(c) > 1e-6 ? Math.atan2(-r[3], r[0]) : 0;
  return { x: m[12], y: m[13], z: m[14], rx, ry, rz, scale: (sx + sy + sz) / 3 };
}
