// Pure helpers for TRYON. No DOM, so they can be tested with node.

/** Face pose from the two outer eye-corner landmarks (already mirrored if the view is). */
export function poseFromEyes(a, b, w, h) {
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
  const dx = bx - ax, dy = by - ay;
  // the two eye-corner landmarks can arrive in either x order (mirroring flips it),
  // which would swing `angle` by ±π and turn the frame upside down. Fold roll into
  // [-90°, 90°] so a level head always reads ~0.
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  return {
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    angle,
    eyeSpan: Math.hypot(dx, dy),
  };
}

/** Average of the 4 corner pixels — the assumed background colour of a product shot. */
export function sampleCorners(data, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const c = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  return [0, 1, 2].map(k => Math.round(c.reduce((s, p) => s + p[k], 0) / 4));
}

/** Alpha-out every pixel within `tol` of `bg`. Returns how many pixels were cut. */
export function keyOut(data, bg, tol) {
  let cut = 0;
  const t2 = tol * tol * 3;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= t2) { data[i + 3] = 0; cut++; }
  }
  return cut;
}

/* ---------- canvas drawing (unit space: total frame width 1, centred on the eyes) ---------- */
function lensPath(ctx, shape, sx) {
  ctx.beginPath();
  if (shape === 'round') ctx.ellipse(sx * 0.28, 0, 0.2, 0.17, 0, 0, Math.PI * 2);
  else if (shape === 'square') ctx.roundRect(sx * 0.28 - 0.21, -0.15, 0.42, 0.3, 0.05);
  else { // cat-eye: outer top corner lifted
    const cx = sx * 0.28;
    ctx.moveTo(cx - sx * 0.21, -0.19);
    ctx.quadraticCurveTo(cx + sx * 0.21, -0.15, cx + sx * 0.2, -0.02);
    ctx.quadraticCurveTo(cx + sx * 0.15, 0.17, cx - sx * 0.05, 0.15);
    ctx.quadraticCurveTo(cx - sx * 0.22, 0.1, cx - sx * 0.21, -0.19);
  }
  ctx.closePath();
}

/**
 * Temple arms in unit space. `yaw` (>0 head turned to its right) lengthens the arm
 * that swings toward camera and foreshortens the other, so a 3/4 view reads right.
 */
export function drawTemples(ctx, frameColor, yaw = 0, rim = 1) {
  ctx.save();
  ctx.lineWidth = 0.03 * rim; ctx.lineJoin = ctx.lineCap = 'round'; ctx.strokeStyle = frameColor;
  for (const sx of [-1, 1]) {
    const reach = 0.14 * (1 + sx * yaw * 2.2);        // near-side arm gets longer
    if (reach <= 0.02) continue;
    ctx.beginPath();
    ctx.moveTo(sx * 0.47, -0.12);
    ctx.quadraticCurveTo(sx * (0.5 + reach), -0.12, sx * (0.5 + reach), -0.05);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawVector(ctx, shape, frameColor, lensColor, yaw = 0, rim = 1) {
  drawTemples(ctx, frameColor, yaw, rim);
  ctx.lineWidth = 0.035 * rim; ctx.lineJoin = ctx.lineCap = 'round'; ctx.strokeStyle = frameColor;
  for (const sx of [-1, 1]) {
    lensPath(ctx, shape, sx);
    ctx.fillStyle = lensColor; ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-0.08, -0.05); ctx.quadraticCurveTo(0, -0.11, 0.08, -0.05); ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sx * 0.48, -0.1); ctx.lineTo(sx * 0.52, -0.08); ctx.stroke();
  }
}

// image frames are tinted through an offscreen cache so the tint stays inside the cut-out
const tintCache = new Map();
export function tinted(frame, color) {
  const key = frame.id + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const src = frame.canvas, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = 0.45; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}

/**
 * Draw one frame onto ctx at a face pose. `fit` = {w,h,y,r}.
 * spanRatio/yRatio come from the photo the frame was cut out of, so an extracted
 * frame lands at the size and height it had on that face.
 * ponytail: yaw only squashes the sprite horizontally — a real 3D frame would rotate.
 */
export function drawFrame(ctx, frame, pose, fit, frameColor, lensColor, alpha = 1) {
  const span = pose.eyeSpan;
  const s = span * (frame.spanRatio ?? 1.6) * fit.w;
  const yaw = Math.max(0.45, 1 - Math.abs(pose.yaw ?? 0) * 1.6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pose.cx, pose.cy);
  ctx.rotate(pose.angle + fit.r * Math.PI / 180);
  ctx.translate(span * (pose.yaw ?? 0) * 0.12, span * ((frame.yRatio ?? 0) + fit.y));
  ctx.scale(s * yaw, s * fit.h);
  if (frame.canvas) {
    drawTemples(ctx, frameColor, pose.yaw ?? 0);   // extracted photos rarely include arms
    const img = tinted(frame, frameColor), ar = img.height / img.width;
    ctx.drawImage(img, -0.5, -ar / 2, 1, ar);
  } else {
    drawVector(ctx, frame.shape, frameColor, lensColor, pose.yaw ?? 0, frame.rim ?? 1);
  }
  ctx.restore();
}

/* ---------- smart fit ---------- */

// MediaPipe FaceLandmarker indices we lean on
const LM = { eyeL: 33, eyeR: 263, cheekL: 234, cheekR: 454, brow: 168, chin: 152, forehead: 10 };

/**
 * Suggest {w,h,y,r} sliders so a frame sits like real glasses: about as wide as the
 * face, centred on the brow line. Pure — takes raw (un-mirrored) landmarks.
 */
export function smartFit(lm, frame, w, h) {
  const px = i => ({ x: lm[i].x * w, y: lm[i].y * h });
  const eyeSpan = Math.hypot(px(LM.eyeR).x - px(LM.eyeL).x, px(LM.eyeR).y - px(LM.eyeL).y);
  const faceW = Math.hypot(px(LM.cheekR).x - px(LM.cheekL).x, px(LM.cheekR).y - px(LM.cheekL).y);
  const spanRatio = frame?.spanRatio ?? 1.6;

  // frame total width should be ~0.94 of the face; solve for the fit.w multiplier
  const wMul = clamp((faceW * 0.94) / (eyeSpan * spanRatio), 0.6, 1.6);

  // brow landmark vs eye-corner midline, as a fraction of eyeSpan
  const eyeMidY = (px(LM.eyeL).y + px(LM.eyeR).y) / 2;
  const yOff = clamp(((px(LM.brow).y - eyeMidY) / eyeSpan) - (frame?.yRatio ?? 0), -0.4, 0.4);

  return { w: round2(wMul), h: 1, y: round2(yOff), r: 0 };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = v => Math.round(v * 100) / 100;

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
 * { x,y,z, rx,ry,rz (radians, XYZ order), scale }. Pure, so it can be unit-tested.
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

/** Crop a rect out of an image element and knock out its background. */
export function extractFrame(img, sel, tol) {
  const c = document.createElement('canvas');
  c.width = Math.round(sel.w); c.height = Math.round(sel.h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height);
  keyOut(data.data, sampleCorners(data.data, c.width, c.height), tol);
  x.putImageData(data, 0, 0);
  return c;
}
